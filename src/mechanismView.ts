import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { DEG, FlightModel, TC_CANT, clamp } from './physics';
import { signalToAngle, STD_MARK_DEG } from './gauges';

export type MechType = 'tns' | 'tc';

export interface CinematicShot {
  pos: [number, number, number];
  target: [number, number, number];
  drift?: number;
}

const ROTOR_VIS_SPIN = 10; // rad/s, gözle takip edilebilir görsel hız
const DIAL_Z = 3.55;
const UP = new THREE.Vector3(0, 1, 0);

// T&S tersleyici çatal-pim mekanizması geometrisi
const TNS_GIMBAL_Y = 0.34; // Yatay gimbal ekseni yüksekliği
const TNS_SHAFT_Y = -0.24; // İğne mili yüksekliği (SVG PIVOT_Y = 168 ile birebir)
const TNS_ARM_R = 0.36; // Gimbal merkezinden tahrik pimine mesafe (y_pin = -0.02)
const TNS_FORK_L = 0.22; // İğne milinden tahrik pimine mesafe (y_pin - y_shaft = 0.22)

// TC sektör dişli ve pinyon mekanizması geometrisi
const TC_PIVOT_Z = 0.32; // Eğik gimbal merkez z konumu
const TC_GEAR_RATIO = 0.52; // gimbal yatma / uçak silüeti dönme oranı

function label(text: string, cls = '') {
  const div = document.createElement('div');
  div.className = `label3d ${cls}`.trim();
  div.textContent = text;
  return new CSS2DObject(div);
}

/**
 * XY düzleminde, +z etrafında saat yönü tersine dönen kavisli ok.
 * Yay `center` açısı etrafında ortalanır (varsayılan: +y, üst).
 * Dış grubun scale.x = -1 yapılması oku yerinde tutarak yönünü ters çevirir.
 */
function curvedArrow(radius: number, arc: number, color: number, tube = 0.055, center = Math.PI / 2) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.z = center - arc / 2;
  g.add(inner);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: true,
  });
  const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 48, arc), mat);
  inner.add(torus);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.2, tube * 7, 14), mat);
  cone.position.set(radius * Math.cos(arc), radius * Math.sin(arc), 0);
  cone.rotation.z = arc;
  inner.add(cone);
  return { group: g, mat };
}

/**
 * Birim uzunlukta (y: 0 -> 1) 3B helisel yay modeli oluşturur.
 * `placeBetween` ile her karede iki 3B nokta arasına dinamik olarak gerilir.
 */
function createHelicalSpring(
  radius: number,
  wireRadius: number,
  coils: number,
  mat: THREE.Material,
): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  pts.push(new THREE.Vector3(0, 0, 0));
  pts.push(new THREE.Vector3(0, 0.1, 0));
  const steps = coils * 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * coils * Math.PI * 2;
    const y = 0.12 + t * 0.76;
    pts.push(new THREE.Vector3(Math.cos(ang) * radius, y, Math.sin(ang) * radius));
  }
  pts.push(new THREE.Vector3(0, 0.9, 0));
  pts.push(new THREE.Vector3(0, 1.0, 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, steps + 12, wireRadius, 8, false);
  return new THREE.Mesh(geo, mat);
}

function placeBetween(obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  const len = d.length();
  obj.position.copy(a);
  obj.scale.set(1, Math.max(len, 0.001), 1);
  if (len > 0.0001) {
    obj.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  }
}

/** Dişli çark veya sektör dişli oluşturucu. */
function createGearSegment(
  pitchRadius: number,
  thickness: number,
  toothCount: number,
  arcStart: number,
  arcLength: number,
  innerRadius: number,
  mat: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const rootR = pitchRadius - 0.026;
  const tipR = pitchRadius + 0.03;
  if (arcLength >= Math.PI * 1.99) {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(rootR, rootR, thickness, 32).rotateX(Math.PI / 2),
      mat,
    );
    g.add(body);
  } else {
    const ringGeo = new THREE.RingGeometry(innerRadius, rootR, 28, 1, arcStart, arcLength);
    const front = new THREE.Mesh(ringGeo, mat);
    front.position.z = thickness / 2;
    const back = new THREE.Mesh(ringGeo, mat);
    back.position.z = -thickness / 2;
    back.rotation.y = Math.PI;
    const outerBand = new THREE.Mesh(
      new THREE.CylinderGeometry(
        rootR,
        rootR,
        thickness,
        28,
        1,
        true,
        arcStart + Math.PI / 2,
        arcLength,
      ).rotateX(Math.PI / 2),
      mat,
    );
    g.add(front, back, outerBand);
  }
  const toothW = ((pitchRadius * arcLength) / toothCount) * 0.48;
  const toothH = tipR - rootR + 0.022;
  const toothGeo = new THREE.BoxGeometry(toothW, toothH, thickness * 0.96);
  for (let i = 0; i <= toothCount; i++) {
    if (arcLength >= Math.PI * 1.99 && i === toothCount) continue;
    const a = arcStart + (i / toothCount) * arcLength;
    const t = new THREE.Mesh(toothGeo, mat);
    const r = (rootR + tipR) * 0.5;
    t.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
    t.rotation.z = a - Math.PI / 2;
    g.add(t);
  }
  return g;
}

// ---- Kadran dokuları: sağdaki SVG göstergelerin birebir canvas kopyası ----
const DIAL_PX = 512;
const DS = DIAL_PX / 300;
const DC = DIAL_PX / 2;
/** Top yayının yarıçapı (dünya birimi). */
const BALL_ARC_R = 4.0;

function dialCtx(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = DIAL_PX;
  return [c, c.getContext('2d')!];
}

function dialBase(x: CanvasRenderingContext2D, faceColor: string, faceR: number) {
  x.clearRect(0, 0, DIAL_PX, DIAL_PX);
  x.fillStyle = 'rgba(16, 18, 22, 0.84)';
  x.beginPath();
  x.arc(DC, DC, 250, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#3c4046';
  x.lineWidth = 10;
  x.beginPath();
  x.arc(DC, DC, 244, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = 'rgba(12, 12, 14, 0.8)';
  x.beginPath();
  x.arc(DC, DC, 139 * DS, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = faceColor;
  x.beginPath();
  x.arc(DC, DC, faceR * DS, 0, Math.PI * 2);
  x.fill();
}

function dialText(
  x: CanvasRenderingContext2D,
  text: string,
  svgX: number,
  svgY: number,
  px: number,
  color = '#f4f4f4',
) {
  x.fillStyle = color;
  x.font = `700 ${px}px 'Segoe UI', Arial, sans-serif`;
  x.textAlign = 'center';
  x.fillText(text, svgX * DS, svgY * DS);
}

/**
 * Top tüpü penceresi: 3D cam tüp ve bilyenin kadran yuvasında görünmesi için
 * çerçeve + yarı saydam fosforlu arka plan + merkez lubber çizgileri.
 */
function dialTube(x: CanvasRenderingContext2D, bottomY: number) {
  const R = 300 * DS;
  const yc = (bottomY - 300) * DS;
  const a = (16 * Math.PI) / 180;
  x.save();
  x.lineCap = 'round';
  x.strokeStyle = '#181a1d';
  x.lineWidth = 35 * DS;
  x.beginPath();
  x.arc(DC, yc, R, Math.PI / 2 - a, Math.PI / 2 + a);
  x.stroke();
  x.strokeStyle = 'rgba(225, 228, 220, 0.52)';
  x.lineWidth = 29 * DS;
  x.beginPath();
  x.arc(DC, yc, R, Math.PI / 2 - a, Math.PI / 2 + a);
  x.stroke();
  // Orta referans çentikleri
  x.strokeStyle = '#151515';
  x.lineWidth = 3 * DS;
  for (const dx of [-15, 15]) {
    x.beginPath();
    x.moveTo(DC + dx * DS, (bottomY - 17) * DS);
    x.lineTo(DC + dx * DS, (bottomY + 17) * DS);
    x.stroke();
  }
  x.restore();
}

function dialFinish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Turn & Slip yüzü: doghouse + yan oklar, L/R üstte, iğne pivotu altta. */
function tnsFaceTexture(): THREE.CanvasTexture {
  const [c, x] = dialCtx();
  dialBase(x, 'rgba(42, 42, 46, 0.74)', 130);
  const pivotY = 168 * DS;
  const mark = (pts: number[][], ox: number, oy: number) => {
    x.beginPath();
    pts.forEach(([px, py], i) => {
      const X = ox + px * DS;
      const Y = oy + py * DS;
      if (i === 0) x.moveTo(X, Y);
      else x.lineTo(X, Y);
    });
    x.closePath();
    x.fill();
  };
  x.fillStyle = '#f4f4f4';
  for (const d of [-STD_MARK_DEG, 0, STD_MARK_DEG]) {
    x.save();
    x.translate(DC, pivotY);
    x.rotate(d * DEG);
    mark(
      d === 0
        ? [
            [-15, -12],
            [15, -12],
            [15, 2],
            [0, 10],
            [-15, 2],
          ]
        : [
            [-8, -12],
            [8, -12],
            [8, 4],
            [0, 12],
            [-8, 4],
          ],
      0,
      -128 * DS,
    );
    x.restore();
  }
  dialText(x, 'L', 92, 92, 48);
  dialText(x, 'R', 208, 92, 48);
  x.fillStyle = '#111111';
  x.fillRect(214 * DS, 120 * DS, 24 * DS, 30 * DS);
  x.strokeStyle = '#666666';
  x.lineWidth = 2 * DS;
  x.strokeRect(214 * DS, 120 * DS, 24 * DS, 30 * DS);
  dialTube(x, 222);
  dialText(x, '2 MIN  TURN', 150, 260, 31);
  dialText(x, 'DC   ELEC', 150, 276, 16, '#d8d8d8');
  return dialFinish(c);
}

/** Turn Coordinator yüzü: yan çizgi işaretler, L/R + yazılar altta. */
function tcFaceTexture(): THREE.CanvasTexture {
  const [c, x] = dialCtx();
  dialBase(x, 'rgba(46, 46, 50, 0.72)', 112);
  x.strokeStyle = '#ffffff';
  x.lineWidth = 7 * DS;
  for (const deg of [0, STD_MARK_DEG]) {
    for (const side of [1, -1]) {
      const a = (side === 1 ? deg : 180 - deg) * DEG;
      x.beginPath();
      x.moveTo(DC + Math.cos(a) * 114 * DS, DC + Math.sin(a) * 114 * DS);
      x.lineTo(DC + Math.cos(a) * 135 * DS, DC + Math.sin(a) * 135 * DS);
      x.stroke();
    }
  }
  dialText(x, 'D.C.', 150, 44, 20, '#d8d8d8');
  dialText(x, 'ELEC.', 150, 58, 20, '#d8d8d8');
  dialText(x, 'TURN COORDINATOR', 150, 196, 20);
  dialText(x, 'L', 84, 262, 48);
  dialText(x, 'R', 216, 262, 48);
  dialTube(x, 226);
  dialText(x, '2 MIN.', 150, 262, 31);
  dialText(x, 'NO PITCH INFORMATION', 150, 277, 16, '#d8d8d8');
  return dialFinish(c);
}

export class MechanismView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(39, 1, 0.1, 200);
  readonly controls: OrbitControls;
  type: MechType = 'tns';

  // İki ayrı mekanizma grubu
  private tnsRoot = new THREE.Group();
  private tcRoot = new THREE.Group();

  // ---- Turn & Slip Mekanizması ----
  private tnsGimbal = new THREE.Group();
  private tnsRotor = new THREE.Group();
  private tnsPinWorld = new THREE.Object3D();
  private tnsSpringAttach = new THREE.Object3D();
  private tnsSpringAnchor = new THREE.Vector3(-1.52, 0.18, 2.02);
  private tnsSpringMesh!: THREE.Mesh;
  private tnsDashArmTip = new THREE.Object3D();
  private tnsDashPiston = new THREE.Group();
  private tnsDashRod!: THREE.Mesh;
  private tnsPointerGroup = new THREE.Group(); // Mil + çatal + karşı ağırlık + ön iğne

  // ---- Turn Coordinator Mekanizması ----
  private tcCantGroup = new THREE.Group(); // 30° eğik eksen grubu
  private tcGimbal = new THREE.Group();
  private tcRotor = new THREE.Group();
  private tcPinionGroup = new THREE.Group(); // Pinyon mili + pinyon dişli + uçak silüeti
  private tcSpringAttach = new THREE.Object3D();
  private tcSpringAnchor = new THREE.Vector3(0.08, 1.32, 2.08);
  private tcSpringMesh!: THREE.Mesh;
  private tcGlassDashGroup = new THREE.Group(); // Edessa fotoğrafındaki eğik cam tüplü damper
  private tcDashCrank = new THREE.Object3D();
  private tcDashPiston = new THREE.Group();
  private tcDashRod!: THREE.Mesh;

  // ---- Ortak kadran ve 3B inklinometre (cam tüp + bilye) ----
  private dialMat!: THREE.MeshBasicMaterial;
  private inclinometerGroup = new THREE.Group();
  private ball!: THREE.Mesh;
  private ballYc = 3.04;

  // ---- Dinamik vektör okları ve 3B açıklamalar ----
  private spinArrow: ReturnType<typeof curvedArrow>;
  private yawArrow: ReturnType<typeof curvedArrow>;
  private rollArrow: ReturnType<typeof curvedArrow>;
  private precArrow: ReturnType<typeof curvedArrow>;
  private spinHolder = new THREE.Group();
  private precHolder = new THREE.Group();

  private axisLabel: CSS2DObject;
  private rotorLabel: CSS2DObject;
  private linkageLabel: CSS2DObject;
  private damperLabel: CSS2DObject;
  private springLabel: CSS2DObject;
  private auxLabel: CSS2DObject;
  private needleLabel: CSS2DObject;
  private inclinometerLabel: CSS2DObject;
  private spinLabel: CSS2DObject;
  private yawLabel: CSS2DObject;
  private rollLabel: CSS2DObject;
  private precLabel: CSS2DObject;

  private partLabelsVisible = false;
  private partLabels: CSS2DObject[] = [];

  // Sinematik kamera kontrolü
  private cinematicShot: CinematicShot | null = null;
  private cinematicUserPaused = false;
  private cinematicTime = 0;
  private camGoalPos = new THREE.Vector3();
  private camGoalTarget = new THREE.Vector3();

  constructor(dom: HTMLElement) {
    const s = this.scene;
    s.background = new THREE.Color(0x14181f);

    // Zengin stüdyo aydınlatması (metal ve cam yüzeyleri öne çıkarır)
    s.add(new THREE.HemisphereLight(0xf2f6ff, 0x28303d, 1.45));
    const key = new THREE.DirectionalLight(0xfff8ec, 2.3);
    key.position.set(8, 11, 8);
    s.add(key);
    const fill = new THREE.DirectionalLight(0x9ab8ff, 1.2);
    fill.position.set(-7, 5, 7);
    s.add(fill);
    const rim = new THREE.DirectionalLight(0xffe0b2, 1.0);
    rim.position.set(3, -6, -8);
    s.add(rim);

    // Yan-ön izometrik kesit açısı: kadran arkası mekanizmalar (dişli, çatal-pim, damper, yay) net görünür
    this.camera.position.set(9.1, 3.6, 5.4);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.target.set(0, 0.05, 0.6);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 24;
    this.controls.update();
    // Kullanıcı fareyle sahneyi döndürürse sinematik kamera zorlamasını bırak
    this.controls.addEventListener('start', () => {
      if (this.cinematicShot) this.cinematicUserPaused = true;
    });

    // ---- Gerçekçi PBR Materyaller ----
    const mats = {
      brass: new THREE.MeshStandardMaterial({ color: 0xd8ae56, metalness: 0.78, roughness: 0.25 }),
      darkBrass: new THREE.MeshStandardMaterial({ color: 0xa8823a, metalness: 0.72, roughness: 0.35 }),
      oliveRotor: new THREE.MeshStandardMaterial({ color: 0xa49b6c, metalness: 0.64, roughness: 0.3 }),
      castAlloy: new THREE.MeshStandardMaterial({ color: 0x868e98, metalness: 0.62, roughness: 0.36 }),
      aluminum: new THREE.MeshStandardMaterial({ color: 0xc2cad4, metalness: 0.8, roughness: 0.24 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xd6dde4, metalness: 0.86, roughness: 0.18 }),
      springSteel: new THREE.MeshStandardMaterial({ color: 0xa6b2be, metalness: 0.82, roughness: 0.24 }),
      blackHousing: new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.22, roughness: 0.6 }),
      graphite: new THREE.MeshStandardMaterial({ color: 0x202328, metalness: 0.35, roughness: 0.42 }),
      cutawayCase: new THREE.MeshStandardMaterial({
        color: 0x4e564c,
        metalness: 0.45,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
      ghostCase: new THREE.MeshStandardMaterial({
        color: 0x8fa4b8,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xe8f4ff,
        transparent: true,
        opacity: 0.34,
        roughness: 0.08,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      pcb: new THREE.MeshStandardMaterial({ color: 0x947436, metalness: 0.1, roughness: 0.62 }),
      trimpotBlue: new THREE.MeshStandardMaterial({ color: 0x1e6cc4, metalness: 0.15, roughness: 0.42 }),
      capBlue: new THREE.MeshStandardMaterial({ color: 0x288ce0, metalness: 0.3, roughness: 0.32 }),
      wireRed: new THREE.MeshStandardMaterial({ color: 0xd63030, roughness: 0.48 }),
      wireBlack: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.48 }),
      wireYellow: new THREE.MeshStandardMaterial({ color: 0xe6b822, roughness: 0.48 }),
      sleeveWhite: new THREE.MeshStandardMaterial({
        color: 0xeeeade,
        transparent: true,
        opacity: 0.8,
        roughness: 0.38,
      }),
      white: new THREE.MeshBasicMaterial({ color: 0xf4f4f4 }),
    };

    // 1. Ortak ön gösterge çerçevesi (bezel), kesit kasa ve 3B inklinometre
    this.buildSharedCasingAndDial(mats);

    // 2. Turn-and-Slip mekanizması
    this.buildTurnAndSlipMechanism(mats);
    s.add(this.tnsRoot);

    // 3. Turn Coordinator mekanizması
    this.buildTurnCoordinatorMechanism(mats);
    s.add(this.tcRoot);

    // 4. Dinamik fizik okları ve etiketler
    this.spinArrow = curvedArrow(0.92, Math.PI * 1.22, 0x3fa0ff, 0.05);
    this.spinArrow.group.rotation.y = Math.PI / 2;
    this.spinArrow.group.scale.x = -1;
    this.spinHolder.add(this.spinArrow.group);
    this.spinLabel = label('Cayro dönüşü', 'blue');
    this.spinLabel.position.set(0, 1.12, -0.68);
    this.spinHolder.add(this.spinLabel);
    s.add(this.spinHolder);

    this.precArrow = curvedArrow(1.52, Math.PI * 0.5, 0xff8a1f, 0.058);
    this.precHolder.add(this.precArrow.group);
    this.precLabel = label('Presesyon → gimbal yatar', 'orange');
    this.precLabel.position.set(0, 1.78, 0);
    this.precHolder.add(this.precLabel);
    s.add(this.precHolder);

    this.yawArrow = curvedArrow(1.45, Math.PI * 1.15, 0xff4040, 0.06);
    const yawHolder = new THREE.Group();
    yawHolder.position.set(0, 3.05, 0.1);
    yawHolder.add(this.yawArrow.group);
    this.yawArrow.group.rotation.x = -Math.PI / 2;
    s.add(yawHolder);
    this.yawLabel = label('Uçak yaw dönüşü', 'red');
    this.yawLabel.position.set(0, 3.45, 0.1);
    s.add(this.yawLabel);

    this.rollArrow = curvedArrow(2.0, Math.PI * 0.68, 0xb46cff, 0.06);
    const rollHolder = new THREE.Group();
    rollHolder.position.set(0, 0, -3.55);
    rollHolder.add(this.rollArrow.group);
    s.add(rollHolder);
    this.rollLabel = label('Uçak roll dönüşü', 'purple');
    this.rollLabel.position.set(0, 2.38, -3.55);
    s.add(this.rollLabel);

    // Parça açıklama etiketleri (varsayılan olarak kapalı, 'L' tuşu veya butonuyla açılabilir)
    this.axisLabel = label('', 'axis');
    this.rotorLabel = label('');
    this.linkageLabel = label('');
    this.damperLabel = label('');
    this.springLabel = label('');
    this.auxLabel = label('');
    this.needleLabel = label('');
    this.inclinometerLabel = label('Sıvı dolu kavisli cam tüp + bilye (İnklinometre)');
    this.inclinometerLabel.position.set(1.25, -1.05, DIAL_Z + 0.12);

    s.add(
      this.axisLabel,
      this.rotorLabel,
      this.linkageLabel,
      this.damperLabel,
      this.springLabel,
      this.auxLabel,
      this.needleLabel,
      this.inclinometerLabel,
    );

    this.partLabels = [
      this.axisLabel,
      this.rotorLabel,
      this.linkageLabel,
      this.damperLabel,
      this.springLabel,
      this.auxLabel,
      this.needleLabel,
      this.inclinometerLabel,
    ];

    this.setType('tns');
    this.setLabelsVisible(false);
  }

  /**
   * Ön 4-cıvatalı uçak panel flanşı, kesit silindirik gövde (alt ve arka-sol kabuk dolu,
   * üst ve sağ-ön tamamen açık kesit), yarı saydam kadran ve 3B kavisli cam inklinometre tüpü + bilyesi.
   */
  private buildSharedCasingAndDial(mats: Record<string, THREE.Material>) {
    const s = this.scene;

    // 4 köşeli gösterge paneli montaj flanşı
    const flangeShape = new THREE.Shape();
    const fw = 2.15;
    const fc = 1.54;
    flangeShape.moveTo(-fc, fw);
    flangeShape.lineTo(fc, fw);
    flangeShape.quadraticCurveTo(fw, fw, fw, fc);
    flangeShape.lineTo(fw, -fc);
    flangeShape.quadraticCurveTo(fw, -fw, fc, -fw);
    flangeShape.lineTo(-fc, -fw);
    flangeShape.quadraticCurveTo(-fw, -fw, -fw, -fc);
    flangeShape.lineTo(-fw, fc);
    flangeShape.quadraticCurveTo(-fw, fw, -fc, fw);

    const holePath = new THREE.Path();
    holePath.absarc(0, 0, 1.98, 0, Math.PI * 2, true);
    flangeShape.holes.push(holePath);

    const flangeGeo = new THREE.ExtrudeGeometry(flangeShape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    });
    const flange = new THREE.Mesh(flangeGeo, mats.blackHousing);
    flange.position.z = DIAL_Z - 0.12;
    s.add(flange);

    // 4 köşe montaj vidası
    for (const sx of [-1.64, 1.64]) {
      for (const sy of [-1.64, 1.64]) {
        const screw = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14).rotateX(Math.PI / 2),
          mats.steel,
        );
        screw.position.set(sx, sy, DIAL_Z - 0.03);
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.025, 0.04), mats.blackHousing);
        slot.position.z = 0.1;
        screw.add(slot);
        s.add(screw);
      }
    }

    // CylinderGeometry(...).rotateX(PI/2) dönüşümünde:
    // theta = 0 -> alt (-y), theta = PI/2 -> sağ/ön (+x, kamera tarafı), theta = PI -> üst (+y), theta = 1.5*PI -> sol/arka (-x).
    // Dolayısıyla thetaStart = 1.22*PI, thetaLength = 0.92*PI seçildiğinde kabuk yalnızca sol-arka ve altta kalır;
    // üst (+y) ve kamera tarafı (+x) tamamen açık kesit olur.
    const cutawayStart = Math.PI * 1.22;
    const cutawayLen = Math.PI * 0.92;

    const frontCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(2.12, 2.12, 0.55, 48, 1, true, cutawayStart, cutawayLen).rotateX(
        Math.PI / 2,
      ),
      mats.blackHousing,
    );
    frontCollar.position.z = DIAL_Z - 0.4;
    s.add(frontCollar);

    const outerShell = new THREE.Mesh(
      new THREE.CylinderGeometry(2.38, 2.38, 5.65, 48, 1, true, cutawayStart, cutawayLen).rotateX(
        Math.PI / 2,
      ),
      mats.cutawayCase,
    );
    outerShell.position.z = -0.05;
    s.add(outerShell);

    // Şeffaf tam silindir (kesit kısmını tamamlayan hafif cam kontur)
    const ghostCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(2.37, 2.37, 5.65, 48, 1, true).rotateX(Math.PI / 2),
      mats.ghostCase,
    );
    ghostCyl.position.z = -0.05;
    s.add(ghostCyl);

    for (const z of [-2.88, 2.78]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.38, 0.035, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0x566676 }),
      );
      ring.position.z = z;
      s.add(ring);
    }

    // Kadran yüzeyi
    this.dialMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    });
    const dial = new THREE.Mesh(new THREE.CircleGeometry(2.0, 56), this.dialMat);
    dial.position.z = DIAL_Z;
    s.add(dial);

    // 3B İnklinometre: kavisli cam tüp, uç contaları, referans telleri
    const tubeArc = 32 * DEG;
    const glassTube = new THREE.Mesh(
      new THREE.TorusGeometry(BALL_ARC_R, 0.195, 16, 48, tubeArc),
      mats.glass,
    );
    glassTube.rotation.z = -Math.PI / 2 - tubeArc / 2;
    this.inclinometerGroup.add(glassTube);

    for (const side of [-1, 1]) {
      const endAng = side * (tubeArc / 2);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.1, 16), mats.darkBrass);
      cap.position.set(BALL_ARC_R * Math.sin(endAng), -BALL_ARC_R * Math.cos(endAng), 0);
      cap.rotation.z = endAng + Math.PI / 2;
      this.inclinometerGroup.add(cap);
    }
    for (const side of [-1, 1]) {
      const wireAng = side * 2.8 * DEG;
      const wire = new THREE.Mesh(new THREE.TorusGeometry(0.198, 0.016, 8, 20), mats.blackHousing);
      wire.position.set(BALL_ARC_R * Math.sin(wireAng), -BALL_ARC_R * Math.cos(wireAng), 0);
      wire.rotation.y = Math.PI / 2;
      wire.rotation.x = wireAng;
      this.inclinometerGroup.add(wire);
    }
    this.inclinometerGroup.position.set(0, this.ballYc, DIAL_Z + 0.02);
    s.add(this.inclinometerGroup);

    // 3B siyah akik/çelik bilye
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.18, metalness: 0.25 }),
    );
    this.ball.position.z = DIAL_Z + 0.02;
    s.add(this.ball);
  }

  /**
   * TURN-AND-SLIP INDICATOR (FAA/EASA kesit şeması ve gerçek cihaz mimarisi):
   * - Yatay boyuna gimbal ekseni (y = +0.34)
   * - Çevresinde 28 adet türbin çentiği bulunan ağır pirinç cayro rotoru
   * - Arka vakum/hava jeti nozülü ve alt egzoz rakoru
   * - Gimbal önünde büyük dairesel pirinç plaka
   * - Dairesel plakadan aşağı inen tahrik pimi ve alt iğne milindeki
   *   karşı ağırlıklı yukarı bakan çatal kollar
   * - Sol kolda kalibrasyon/merkezleme yayı, sağ kolda dikey dashpot piston sönümleyici
   */
  private buildTurnAndSlipMechanism(mats: Record<string, THREE.Material>) {
    const root = this.tnsRoot;

    // Boyuna gimbal ekseni kesikli çizgisi
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, TNS_GIMBAL_Y, -3.25),
      new THREE.Vector3(0, TNS_GIMBAL_Y, 2.65),
    ]);
    const axisLine = new THREE.Line(
      axisGeo,
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12 }),
    );
    axisLine.computeLineDistances();
    root.add(axisLine);

    // Arka gövde traversi ve ayarlanabilir muylu yatağı
    const rearBridge = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.36, 0.22), mats.castAlloy);
    rearBridge.position.set(0, TNS_GIMBAL_Y, -2.65);
    root.add(rearBridge);

    const rearBoss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.45, 18).rotateX(Math.PI / 2),
      mats.darkBrass,
    );
    rearBoss.position.set(0, TNS_GIMBAL_Y, -2.7);
    const rearScrew = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.75, 14).rotateX(Math.PI / 2),
      mats.steel,
    );
    rearScrew.position.set(0, TNS_GIMBAL_Y, -2.82);
    const rearLockNut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.12, 6).rotateX(Math.PI / 2),
      mats.brass,
    );
    rearLockNut.position.set(0, TNS_GIMBAL_Y, -3.0);
    root.add(rearBoss, rearScrew, rearLockNut);

    // Vakum / hava jeti nozülü
    const nozzleGroup = new THREE.Group();
    nozzleGroup.position.set(0, 1.9, -1.9);
    nozzleGroup.rotation.x = 0.52;
    const nozzleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.85, 16), mats.brass);
    const nozzleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.16, 16), mats.darkBrass);
    nozzleCap.position.y = 0.44;
    const nozzleTip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.55, 12), mats.brass);
    nozzleTip.position.y = -0.58;
    nozzleGroup.add(nozzleBody, nozzleCap, nozzleTip);
    root.add(nozzleGroup);

    // Alt vakum/egzoz çıkış rakoru
    const exhaustGroup = new THREE.Group();
    exhaustGroup.position.set(0, -2.18, -1.85);
    const exNipple = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16), mats.brass);
    const exHex = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 6), mats.darkBrass);
    exHex.position.y = -0.15;
    const exPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.55, 14), mats.brass);
    exPipe.position.y = -0.45;
    exhaustGroup.add(exNipple, exHex, exPipe);
    root.add(exhaustGroup);

    // Ön yatak köprüsü: hem gimbal ön yatağını hem iğne milini taşır
    const frontBridge = new THREE.Group();
    const bridgeCross = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.2, 0.14), mats.castAlloy);
    bridgeCross.position.set(0, -0.62, 1.68);
    const frontBearingHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.24, 20).rotateX(Math.PI / 2),
      mats.steel,
    );
    frontBearingHousing.position.set(0, TNS_GIMBAL_Y, 1.62);
    const shaftSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.105, 1.05, 16).rotateX(Math.PI / 2),
      mats.darkBrass,
    );
    shaftSleeve.position.set(0, TNS_SHAFT_Y, 2.95);
    frontBridge.add(bridgeCross, frontBearingHousing, shaftSleeve);
    root.add(frontBridge);

    // ---- Yatay Gimbal Çerçevesi (`13` / `17`) ve Büyük Dairesel Ön Plaka (`30` / `38`) ----
    this.tnsGimbal.position.set(0, TNS_GIMBAL_Y, 0);
    root.add(this.tnsGimbal);

    for (const side of [-1, 1]) {
      const sideArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 3.45), mats.brass);
      sideArm.position.set(side * 1.06, 0, -0.58);
      const sideBoss = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.26, 20).rotateZ(Math.PI / 2),
        mats.brass,
      );
      sideBoss.position.set(side * 1.08, 0, -0.58);
      const sideNut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.34, 6).rotateZ(Math.PI / 2),
        mats.darkBrass,
      );
      sideNut.position.set(side * 1.12, 0, -0.58);
      const sidePin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.42, 12).rotateZ(Math.PI / 2),
        mats.steel,
      );
      sidePin.position.set(side * 1.14, 0, -0.58);
      this.tnsGimbal.add(sideArm, sideBoss, sideNut, sidePin);
    }

    const gimbalRearBar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.34, 0.2), mats.brass);
    gimbalRearBar.position.set(0, 0, -2.25);
    const gimbalRearPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.5, 14).rotateX(Math.PI / 2),
      mats.steel,
    );
    gimbalRearPin.position.set(0, 0, -2.48);
    const gimbalFrontBar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.32, 0.18), mats.brass);
    gimbalFrontBar.position.set(0, 0, 1.12);
    this.tnsGimbal.add(gimbalRearBar, gimbalRearPin, gimbalFrontBar);

    // Karakteristik Büyük Dairesel Ön Plaka
    const circularPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(1.22, 1.22, 0.1, 48).rotateX(Math.PI / 2),
      mats.brass,
    );
    circularPlate.position.set(0, 0, 1.28);
    const plateRim = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 10, 48), mats.darkBrass);
    plateRim.position.set(0, 0, 1.32);
    this.tnsGimbal.add(circularPlate, plateRim);

    // Dairesel plaka önündeki T-braket, çift merkezleme yayı ve aşağı inen tahrik kolu
    const centerHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.65, 20).rotateX(Math.PI / 2),
      mats.darkBrass,
    );
    centerHub.position.set(0, 0, 1.65);
    this.tnsGimbal.add(centerHub);

    // Aşağı inen tahrik kolu
    const downArmLen = TNS_ARM_R + 0.1;
    const downArm = new THREE.Mesh(new THREE.BoxGeometry(0.17, downArmLen, 0.09), mats.steel);
    downArm.position.set(0, -TNS_ARM_R * 0.5, 2.02);
    this.tnsGimbal.add(downArm);

    // Tahrik pimi ve kauçuk burcu
    const bushing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.1, 16).rotateX(Math.PI / 2),
      mats.graphite,
    );
    bushing.position.set(0, -TNS_ARM_R, 1.96);
    const drivePin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.044, 0.044, 0.32, 14).rotateX(Math.PI / 2),
      mats.steel,
    );
    drivePin.position.set(0, -TNS_ARM_R, 2.12);
    this.tnsGimbal.add(bushing, drivePin);

    this.tnsPinWorld.position.set(0, -TNS_ARM_R, 2.16);
    this.tnsGimbal.add(this.tnsPinWorld);

    // Yatay sol kol -> Kalibrasyon yayına bağlanır
    const leftBracketArm = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.13, 0.08), mats.darkBrass);
    leftBracketArm.position.set(-0.38, 0.06, 1.94);
    this.tnsGimbal.add(leftBracketArm);
    this.tnsSpringAttach.position.set(-0.72, 0.06, 1.94);
    this.tnsGimbal.add(this.tnsSpringAttach);

    // Yatay sağ kol -> Dashpot piston koluna bağlanır
    const rightLeverArm = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.13, 0.08), mats.steel);
    rightLeverArm.position.set(0.42, 0.0, 1.98);
    this.tnsGimbal.add(rightLeverArm);
    this.tnsDashArmTip.position.set(0.8, 0.0, 1.98);
    this.tnsGimbal.add(this.tnsDashArmTip);

    // İkiz titreşim sönümleme yayları
    for (const sy of [-0.14, 0.16]) {
      const miniSpring = createHelicalSpring(0.045, 0.012, 6, mats.springSteel);
      miniSpring.position.set(-0.24, sy, 1.98);
      miniSpring.rotation.z = -Math.PI / 2;
      miniSpring.scale.set(1, 0.26, 1);
      this.tnsGimbal.add(miniSpring);
    }

    // ---- T&S Türbin Çentikli Pirinç Cayro Rotoru ----
    this.tnsRotor.position.set(0, 0, -0.58);
    this.tnsGimbal.add(this.tnsRotor);

    const tnsAxle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 2.15, 16).rotateZ(Math.PI / 2),
      mats.steel,
    );
    this.tnsRotor.add(tnsAxle);

    const rotorWeb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.28, 36).rotateZ(Math.PI / 2),
      mats.darkBrass,
    );
    const rotorHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.56, 24).rotateZ(Math.PI / 2),
      mats.brass,
    );
    this.tnsRotor.add(rotorWeb, rotorHub);

    const rimShape = new THREE.Shape();
    rimShape.absarc(0, 0, 1.28, 0, Math.PI * 2, false);
    const rimHole = new THREE.Path();
    rimHole.absarc(0, 0, 0.92, 0, Math.PI * 2, true);
    rimShape.holes.push(rimHole);
    const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
      depth: 0.54,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    });
    rimGeo.center();
    rimGeo.rotateY(Math.PI / 2);
    const rotorRim = new THREE.Mesh(rimGeo, mats.brass);
    this.tnsRotor.add(rotorRim);

    const bucketCount = 28;
    const bucketGeo = new THREE.BoxGeometry(0.5, 0.065, 0.14);
    for (let i = 0; i < bucketCount; i++) {
      const a = (i / bucketCount) * Math.PI * 2;
      const bucket = new THREE.Mesh(
        bucketGeo,
        i === 0
          ? new THREE.MeshStandardMaterial({ color: 0xd93829, roughness: 0.35 })
          : mats.darkBrass,
      );
      bucket.position.set(0, Math.cos(a) * 1.26, Math.sin(a) * 1.26);
      bucket.rotation.x = -a + 0.35;
      this.tnsRotor.add(bucket);
    }

    // ---- Kalibrasyon / Merkezleme Yayı ----
    const anchorBlock = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.24), mats.castAlloy);
    anchorBlock.position.copy(this.tnsSpringAnchor);
    const anchorScrew = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10).rotateZ(Math.PI / 2),
      mats.brass,
    );
    anchorScrew.position.set(-1.7, this.tnsSpringAnchor.y, this.tnsSpringAnchor.z);
    root.add(anchorBlock, anchorScrew);

    this.tnsSpringMesh = createHelicalSpring(0.085, 0.02, 10, mats.springSteel);
    root.add(this.tnsSpringMesh);

    // ---- Dikey Pnömatik Dashpot Silindiri ve Pistonu ----
    const dashX = 0.8;
    const dashZ = 1.98;
    const dashTopY = 1.68;
    const dashCylH = 1.02;
    const dashGroup = new THREE.Group();
    dashGroup.position.set(dashX, dashTopY - dashCylH / 2, dashZ);

    const dashBackWall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, dashCylH, 24, 1, true, Math.PI * 0.9, Math.PI * 1.05),
      mats.brass,
    );
    const dashGlassWall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.275, 0.275, dashCylH, 24, 1, true),
      mats.glass,
    );
    const dashCap = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.14, 24), mats.darkBrass);
    dashCap.position.y = dashCylH / 2 + 0.05;
    const dashValve = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.35, 16), mats.brass);
    dashValve.position.y = dashCylH / 2 + 0.24;
    const dashNut = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 6), mats.steel);
    dashNut.position.y = dashCylH / 2 + 0.18;
    dashGroup.add(dashBackWall, dashGlassWall, dashCap, dashValve, dashNut);
    root.add(dashGroup);

    const pistonDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.18, 24), mats.graphite);
    const pistonRing = new THREE.Mesh(new THREE.CylinderGeometry(0.256, 0.256, 0.04, 24), mats.brass);
    this.tnsDashPiston.add(pistonDisk, pistonRing);
    this.tnsDashPiston.position.set(dashX, 0.98, dashZ);
    root.add(this.tnsDashPiston);

    this.tnsDashRod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1, 10), mats.steel);
    root.add(this.tnsDashRod);

    // ---- Alt İğne Mili, Karşı Ağırlık, Çatal ve Ön İğne ----
    this.tnsPointerGroup.position.set(0, TNS_SHAFT_Y, DIAL_Z + 0.04);
    root.add(this.tnsPointerGroup);

    // İğne mili (kadrandan z = 2.12'deki çatal bloğuna uzanır; uzunluk = 1.48)
    const pointerShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 1.5, 14).rotateX(Math.PI / 2),
      mats.steel,
    );
    pointerShaft.position.z = -0.74;
    this.tnsPointerGroup.add(pointerShaft);

    const forkZ = 2.12 - (DIAL_Z + 0.04); // -1.47
    const counterWeight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.16), mats.darkBrass);
    counterWeight.position.set(0, -0.14, forkZ);
    const cwBob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.14, 16).rotateX(Math.PI / 2),
      mats.brass,
    );
    cwBob.position.set(0, -0.28, forkZ);
    this.tnsPointerGroup.add(counterWeight, cwBob);

    // İki paralel çatal kol
    const forkBase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.1), mats.steel);
    forkBase.position.set(0, 0.06, forkZ);
    this.tnsPointerGroup.add(forkBase);
    for (const side of [-1, 1]) {
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 10), mats.steel);
      tine.position.set(side * 0.068, 0.2, forkZ);
      this.tnsPointerGroup.add(tine);
    }


    // Kadran önündeki gerçek Turn & Slip iğnesi (doghouse uçlu, SVG ile birebir)
    const needleShape = new THREE.Shape();
    needleShape.moveTo(-0.055, 0);
    needleShape.lineTo(0.055, 0);
    needleShape.lineTo(0.035, 0.93);
    needleShape.lineTo(0.095, 1.04);
    needleShape.lineTo(0, 1.52);
    needleShape.lineTo(-0.095, 1.04);
    needleShape.lineTo(-0.035, 0.93);
    needleShape.closePath();
    const needleMesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(needleShape, { depth: 0.035, bevelEnabled: false }),
      mats.white,
    );
    needleMesh.position.z = -0.01;
    const needleHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.06, 20).rotateX(Math.PI / 2),
      mats.blackHousing,
    );
    needleHub.position.z = 0.02;
    this.tnsPointerGroup.add(needleMesh, needleHub);
  }

  /**
   * TURN COORDINATOR (Edessa & flight-club fotoğrafları ve fabrika kesiti):
   * - 4 adet çelik kolon saplama + kablo demeti + arka alüminyum plaka + dişli konnektör
   * - Arkada elektronik sürücü devre kartı (PCB: 2 mavi Bourns trimpot, elektrolitik kondansatör, transistör)
   * - 30° eğik gimbal ekseni: ön muylu yatağı altta, arka silikon viskoz sönümlemeli yatak üstte
   * - Döküm/işlenmiş eğik gimbal beşiği: yan yatak şeritleri, vidalar, üst kemer
   * - Zeytuni-altın eloksallı elektrikli dıştan rotorlu cayro tamburu (3 yan dengeleme deliği + siyah merkez kapak)
   * - Gimbal önünden yükselen sektör dişli ve merkez uçak silüeti milindeki pinyon dişli
   * - Üstte kalibrasyon/merkezleme yayı, önde eğik cam tüplü grafit pistonlu damper
   */
  private buildTurnCoordinatorMechanism(mats: Record<string, THREE.Material>) {
    const root = this.tcRoot;

    // ---- 1. İç Şasi: 4 Çelik Standoff Saplama, Arka Plaka, Konnektör ve PCB ----
    const rearPlateZ = -2.75;
    const rearPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(2.22, 2.22, 0.14, 48).rotateX(Math.PI / 2),
      mats.aluminum,
    );
    rearPlate.position.z = rearPlateZ;
    root.add(rearPlate);

    // Arka dairesel dişli havacılık konnektörü
    const connGroup = new THREE.Group();
    connGroup.position.set(0, -0.18, rearPlateZ - 0.42);
    const connBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.52, 0.72, 28).rotateX(Math.PI / 2),
      mats.oliveRotor,
    );
    connGroup.add(connBody);
    for (let i = 0; i < 6; i++) {
      const th = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.022, 8, 28), mats.darkBrass);
      th.position.z = -0.26 + i * 0.09;
      connGroup.add(th);
    }
    const connInside = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.74, 24).rotateX(Math.PI / 2),
      mats.blackHousing,
    );
    connInside.position.z = -0.02;
    connGroup.add(connInside);
    root.add(connGroup);

    // 4 adet çelik kolon saplama (kademeli parlak miller)
    const pillarCoords: [number, number][] = [
      [-1.42, 1.25],
      [1.42, 1.25],
      [-1.42, -1.25],
      [1.42, -1.25],
    ];
    for (const [px, py] of pillarCoords) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.095, 5.5, 16).rotateX(Math.PI / 2),
        mats.steel,
      );
      rod.position.set(px, py, 0.0);
      const rearSleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.145, 1.15, 16).rotateX(Math.PI / 2),
        mats.aluminum,
      );
      rearSleeve.position.set(px, py, -2.12);
      const frontSleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.45, 16).rotateX(Math.PI / 2),
        mats.aluminum,
      );
      frontSleeve.position.set(px, py, 2.55);
      const rearNut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.12, 6).rotateX(Math.PI / 2),
        mats.steel,
      );
      rearNut.position.set(px, py, rearPlateZ - 0.12);
      root.add(rod, rearSleeve, frontSleeve, rearNut);
    }

    // Alt-sağ saplama boyunca giden kırmızı/siyah kablolar ve şeffaf makaron bantları
    for (const [dy, dz, mat] of [
      [0.09, 0.08, mats.wireRed],
      [0.12, -0.05, mats.wireBlack],
    ] as [number, number, THREE.Material][]) {
      const wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 4.7, 8).rotateX(Math.PI / 2),
        mat,
      );
      wire.position.set(1.42 + dz, -1.25 + dy, 0.0);
      root.add(wire);
    }
    for (const sz of [-1.85, 2.05]) {
      const wrap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.175, 0.175, 0.65, 16).rotateX(Math.PI / 2),
        mats.sleeveWhite,
      );
      wrap.position.set(1.42, -1.25, sz);
      root.add(wrap);
    }

    // Arka Elektronik Sürücü Devre Kartı (PCB)
    const pcbZ = -2.32;
    const pcbGroup = new THREE.Group();
    pcbGroup.position.z = pcbZ;
    const pcbBoard = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.85, 0.09), mats.pcb);
    pcbGroup.add(pcbBoard);

    for (const ty of [0.92, 0.34]) {
      const pot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.24), mats.trimpotBlue);
      pot.position.set(0.85, ty, 0.16);
      const dialRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.06, 16).rotateZ(Math.PI / 2),
        mats.aluminum,
      );
      dialRing.position.set(0.22, 0, 0);
      const brassScrew = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12).rotateZ(Math.PI / 2),
        mats.brass,
      );
      brassScrew.position.set(0.24, 0.14, 0.05);
      pot.add(dialRing, brassScrew);
      pcbGroup.add(pot);
    }

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.05, 20), mats.capBlue);
    cap.position.set(-0.85, 0.05, 0.26);
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 20), mats.aluminum);
    capTop.position.y = 0.52;
    cap.add(capTop);
    pcbGroup.add(cap);

    const trans = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.28, 16).rotateZ(Math.PI / 2),
      mats.steel,
    );
    trans.position.set(0.88, -0.82, 0.18);
    pcbGroup.add(trans);
    root.add(pcbGroup);

    // ---- 2. 30° Eğik Gimbal Ekseni (`TC_CANT = 30°`) ve Ön/Arka Yatak + Silikon Viskoz Damper ----
    this.tcCantGroup.position.set(0, 0, TC_PIVOT_Z);
    this.tcCantGroup.rotation.x = TC_CANT * DEG;
    root.add(this.tcCantGroup);

    const tcAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -2.55),
      new THREE.Vector3(0, 0, 2.35),
    ]);
    const tcAxisLine = new THREE.Line(
      tcAxisGeo,
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12 }),
    );
    tcAxisLine.computeLineDistances();
    this.tcCantGroup.add(tcAxisLine);

    // Ön alt muylu yatak bloğu
    const frontBearingBlock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.36, 0.38, 24).rotateX(Math.PI / 2),
      mats.castAlloy,
    );
    frontBearingBlock.position.set(0, 0, 1.48);
    const frontBearingRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 0.42, 20).rotateX(Math.PI / 2),
      mats.steel,
    );
    frontBearingRing.position.set(0, 0, 1.48);
    const frontMountStrut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.3), mats.castAlloy);
    frontMountStrut.position.set(0, -0.22, 1.52);
    this.tcCantGroup.add(frontBearingBlock, frontBearingRing, frontMountStrut);

    // Arka üst bilyalı yatak ve silikon sıvılı viskoz sönümleyici kovanı
    const rearDamperCup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.44, 0.58, 28).rotateX(Math.PI / 2),
      mats.castAlloy,
    );
    rearDamperCup.position.set(0, 0, -1.52);
    const rearDamperCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.68, 24).rotateX(Math.PI / 2),
      mats.darkBrass,
    );
    rearDamperCap.position.set(0, 0, -1.58);
    const rearSupportBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.26, 0.26), mats.castAlloy);
    rearSupportBar.position.set(0, 0, -1.58);
    this.tcCantGroup.add(rearDamperCup, rearDamperCap, rearSupportBar);

    // ---- 3. Döküm Eğik Gimbal Beşiği ----
    this.tcCantGroup.add(this.tcGimbal);

    for (const side of [-1, 1]) {
      const sx = side * 1.08;
      // Yan yatak göbeği (rotorun 3 yan dengeleme deliğini kapatmaması için kompakt çapta)
      const cheek = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.46, 0.16, 16).rotateZ(Math.PI / 2),
        mats.castAlloy,
      );
      cheek.position.set(sx, 0, 0);
      const bossRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.035, 10, 24).rotateY(Math.PI / 2),
        mats.aluminum,
      );
      bossRing.position.set(sx + side * 0.08, 0, 0);
      // Çapraz yatak tutucu çelik şerit ve 2 adet düz başlı vida
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.84), mats.aluminum);
      strap.position.set(sx + side * 0.1, 0, 0);
      for (const sz of [-0.28, 0.28]) {
        const screw = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12).rotateZ(Math.PI / 2),
          mats.steel,
        );
        screw.position.set(sx + side * 0.11, 0, sz);
        this.tcGimbal.add(screw);
      }
      const centerBearing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.24, 16).rotateZ(Math.PI / 2),
        mats.darkBrass,
      );
      centerBearing.position.set(sx + side * 0.04, 0, 0);

      // Ön ve arka muylulara uzanan nervürlü gimbal kolları
      const frontYokeArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 1.38), mats.castAlloy);
      frontYokeArm.position.set(sx * 0.96, 0, 0.65);
      const rearYokeArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 1.38), mats.castAlloy);
      rearYokeArm.position.set(sx * 0.96, 0, -0.65);

      this.tcGimbal.add(cheek, bossRing, strap, centerBearing, frontYokeArm, rearYokeArm);
    }

    const gimbalFrontYoke = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.36, 0.22), mats.castAlloy);
    gimbalFrontYoke.position.set(0, 0, 1.24);
    const gimbalFrontShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.48, 16).rotateX(Math.PI / 2),
      mats.steel,
    );
    gimbalFrontShaft.position.set(0, 0, 1.42);

    const gimbalRearYoke = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.36, 0.22), mats.castAlloy);
    gimbalRearYoke.position.set(0, 0, -1.24);
    const gimbalRearShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.55, 16).rotateX(Math.PI / 2),
      mats.steel,
    );
    gimbalRearShaft.position.set(0, 0, -1.45);

    // Üst kavisli koruyucu kemer
    const topArch = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.25, 2.06, 32, 1, true, -Math.PI * 0.28, Math.PI * 0.56).rotateZ(
        Math.PI / 2,
      ),
      mats.castAlloy,
    );
    this.tcGimbal.add(gimbalFrontYoke, gimbalFrontShaft, gimbalRearYoke, gimbalRearShaft, topArch);

    // ---- 4. Zeytuni-Altın Elektrikli Cayro Rotor Tamburu ----
    this.tcGimbal.add(this.tcRotor);

    const drumMain = new THREE.Mesh(
      new THREE.CylinderGeometry(1.14, 1.14, 1.56, 48).rotateZ(Math.PI / 2),
      mats.oliveRotor,
    );
    this.tcRotor.add(drumMain);

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(
        new THREE.CylinderGeometry(1.14, 0.96, 0.18, 48).rotateZ(
          side > 0 ? -Math.PI / 2 : Math.PI / 2,
        ),
        mats.oliveRotor,
      );
      shoulder.position.x = side * 0.86;
      // Siyah eloksallı merkez göbek kapağı
      const blackCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.1, 28).rotateZ(Math.PI / 2),
        mats.blackHousing,
      );
      blackCap.position.x = side * 0.94;
      const brassCenter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.14, 16).rotateZ(Math.PI / 2),
        mats.brass,
      );
      brassCenter.position.x = side * 0.96;
      this.tcRotor.add(shoulder, blackCap, brassCenter);

      // 3 adet dairesel yan dengeleme/kontrol deliği
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const holeMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 0.06, 18).rotateZ(Math.PI / 2),
          mats.blackHousing,
        );
        holeMesh.position.set(side * 0.93, Math.cos(a) * 0.68, Math.sin(a) * 0.68);
        this.tcRotor.add(holeMesh);
      }
    }

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.045, 0.045),
        i === 0
          ? new THREE.MeshStandardMaterial({ color: 0xd93829, roughness: 0.35 })
          : mats.darkBrass,
      );
      slot.position.set(0, Math.cos(a) * 1.13, Math.sin(a) * 1.13);
      slot.rotation.x = -a;
      this.tcRotor.add(slot);
    }

    // ---- 5. Sektör Dişli ve Pinyon Dişli Mekanizması ----
    // TC_PIVOT_Z = 0.32'de, local z = 1.44 noktası dünya koordinatlarında:
    // y_world = -1.44 * sin(30°) = -0.72, z_world = 0.32 + 1.44 * cos(30°) = 1.57.
    // Sektör dişli kolu z = +0.51 kadar öne uzanarak z_world = 2.08 düzleminde,
    // yarıçap 0.47 ile y_world = -0.72 + 0.47 = -0.25 noktasında pinyon dişlisinin (r = 0.25) altıyla kavraşır!
    const sectorHolder = new THREE.Group();
    sectorHolder.position.set(0, 0, 1.44);
    sectorHolder.rotation.x = -TC_CANT * DEG;
    this.tcGimbal.add(sectorHolder);

    const sectorArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.09), mats.brass);
    sectorArm.position.set(0, 0.23, 0.51);
    sectorHolder.add(sectorArm);

    const sectorBridge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.54), mats.brass);
    sectorBridge.position.set(0, 0.02, 0.26);
    sectorHolder.add(sectorBridge);

    const sectorGear = createGearSegment(
      0.47,
      0.1,
      9,
      Math.PI * 0.32,
      Math.PI * 0.36,
      0.34,
      mats.brass,
    );
    sectorGear.position.set(0, 0, 0.51);
    sectorHolder.add(sectorGear);

    // Kalibrasyon yayının gimbal üzerindeki bağlantı kulağı
    this.tcSpringAttach.position.set(0.08, 0.44, 0.51);
    sectorHolder.add(this.tcSpringAttach);

    // Yan krank pimi -> damper silindirine bağlanır
    // local (1.18, -0.05, 1.12) -> world: x = 1.18, y ≈ -0.60, z ≈ 1.29
    this.tcDashCrank.position.set(1.18, -0.05, 1.12);
    this.tcGimbal.add(this.tcDashCrank);
    const crankPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.24, 12).rotateZ(Math.PI / 2),
      mats.brass,
    );
    crankPin.position.copy(this.tcDashCrank.position);
    this.tcGimbal.add(crankPin);

    // Merkez pinyon mili yatak burcu
    const pinionSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 1.15, 18).rotateX(Math.PI / 2),
      mats.darkBrass,
    );
    pinionSleeve.position.set(0, 0, 2.88);
    root.add(pinionSleeve);

    // Pinyon mili, Pinyon dişlisi ve Ön Uçak Silüeti
    this.tcPinionGroup.position.set(0, 0, DIAL_Z + 0.04);
    root.add(this.tcPinionGroup);

    const gearZRel = 2.08 - (DIAL_Z + 0.04); // -1.51
    const pinionShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.6, 14).rotateX(Math.PI / 2),
      mats.steel,
    );
    pinionShaft.position.z = -0.78;
    this.tcPinionGroup.add(pinionShaft);

    const pinionGear = createGearSegment(0.25, 0.11, 14, 0, Math.PI * 2, 0.06, mats.brass);
    pinionGear.position.z = gearZRel;
    this.tcPinionGroup.add(pinionGear);

    // Kadran önündeki TC Uçak Silüeti
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.085, 0.04), mats.white);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.04), mats.white);
    fin.position.y = 0.21;
    const tailplane = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.065, 0.04), mats.white);
    tailplane.position.y = 0.31;
    const hubPlane = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24).rotateX(Math.PI / 2),
      mats.white,
    );
    const hubDot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.06, 16).rotateX(Math.PI / 2),
      mats.castAlloy,
    );
    this.tcPinionGroup.add(wing, fin, tailplane, hubPlane, hubDot);

    // ---- 6. Kalibrasyon Yayı ----
    const calBracket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.24), mats.castAlloy);
    calBracket.position.copy(this.tcSpringAnchor);
    const calScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 12), mats.brass);
    calScrew.position.set(this.tcSpringAnchor.x, this.tcSpringAnchor.y + 0.18, this.tcSpringAnchor.z);
    root.add(calBracket, calScrew);

    this.tcSpringMesh = createHelicalSpring(0.08, 0.018, 9, mats.springSteel);
    root.add(this.tcSpringMesh);

    // ---- 7. Eğik Cam Tüplü Grafit Pistonlu Damper (Edessa Aviation 1m13s.png cam silindir + koyu piston) ----
    // Alt ağzı doğrudan (1.18, -0.60, 1.29) krank pimine bakacak şekilde eksenel hizalı
    this.tcGlassDashGroup.position.set(1.18, 0.38, 1.56);
    this.tcGlassDashGroup.rotation.x = -0.27;
    root.add(this.tcGlassDashGroup);

    const glassCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.96, 24, 1, true),
      mats.glass,
    );
    const glassTopCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.12, 24),
      mats.aluminum,
    );
    glassTopCap.position.y = 0.5;
    const glassSealRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.23, 0.024, 8, 24).rotateX(Math.PI / 2),
      mats.brass,
    );
    glassSealRing.position.y = 0.4;
    this.tcGlassDashGroup.add(glassCyl, glassTopCap, glassSealRing);

    const tcPistonBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.36, 20),
      mats.graphite,
    );
    const tcPistonBrassStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12),
      mats.brass,
    );
    tcPistonBrassStem.position.y = -0.21;
    this.tcDashPiston.add(tcPistonBody, tcPistonBrassStem);
    this.tcGlassDashGroup.add(this.tcDashPiston);

    this.tcDashRod = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1, 10), mats.brass);
    root.add(this.tcDashRod);
  }

  setType(t: MechType) {
    this.type = t;
    const isTC = t === 'tc';

    this.tnsRoot.visible = !isTC;
    this.tcRoot.visible = isTC;

    // Kadran dokusunu sağdaki göstergeyle eşle
    const old = this.dialMat.map;
    this.dialMat.map = isTC ? tcFaceTexture() : tnsFaceTexture();
    this.dialMat.needsUpdate = true;
    if (old) old.dispose();

    // 3B inklinometre cam tüpü yüksekliğini kadrana hizala
    const bottomY = isTC ? 226 : 222;
    this.ballYc = ((DC - (bottomY - 300) * DS) / DC) * 2.0;
    this.inclinometerGroup.position.y = this.ballYc;

    // Tipe özgü mühendislik etiketlerini çakışmayacak şekilde 3B uzaya yerleştir
    if (isTC) {
      (this.axisLabel.element as HTMLDivElement).textContent =
        `Gimbal ekseni ${TC_CANT}° yukarı eğik → yaw + roll algılar`;
      this.axisLabel.position.set(0, 1.75, -0.45);

      (this.rotorLabel.element as HTMLDivElement).textContent =
        'Eğik elektrikli cayro rotoru (30°)';
      this.rotorLabel.position.set(0, 1.32, 0.35);

      (this.linkageLabel.element as HTMLDivElement).textContent =
        'Sektör dişli ve pinyon';
      this.linkageLabel.position.set(0.25, -0.88, 2.15);

      (this.damperLabel.element as HTMLDivElement).textContent =
        'Cam tüplü grafit pistonlu damper';
      this.damperLabel.position.set(1.65, 0.68, 1.35);

      (this.springLabel.element as HTMLDivElement).textContent = 'Kalibrasyon / merkezleme yayı';
      this.springLabel.position.set(0, 1.85, 2.38);

      (this.auxLabel.element as HTMLDivElement).textContent =
        'Sürücü devre kartı (PCB) ve konnektör';
      this.auxLabel.position.set(0, -1.65, -2.55);

      (this.needleLabel.element as HTMLDivElement).textContent =
        'Uçak silüeti (pinyon miline bağlı)';
      this.needleLabel.position.set(0, -2.38, DIAL_Z);

      this.precHolder.position.set(0, -0.62, 1.75);
      this.precHolder.rotation.x = TC_CANT * DEG;
    } else {
      (this.axisLabel.element as HTMLDivElement).textContent =
        'Gimbal ekseni (yatay boyuna eksen)';
      this.axisLabel.position.set(0, 0.68, -2.85);

      (this.rotorLabel.element as HTMLDivElement).textContent =
        'Yatay cayro rotoru (türbin çentikli)';
      this.rotorLabel.position.set(0, 1.85, -0.65);

      (this.linkageLabel.element as HTMLDivElement).textContent =
        'Dairesel plaka ve tersleyici çatal-pim';
      this.linkageLabel.position.set(0.45, -0.88, 1.95);

      (this.damperLabel.element as HTMLDivElement).textContent =
        'Pnömatik dashpot piston';
      this.damperLabel.position.set(1.25, 1.65, 1.75);

      (this.springLabel.element as HTMLDivElement).textContent = 'Kalibrasyon / merkezleme yayı';
      this.springLabel.position.set(-1.65, 0.08, 2.25);

      (this.auxLabel.element as HTMLDivElement).textContent = 'Vakum hava jeti nozülü';
      this.auxLabel.position.set(0, 2.45, -1.95);

      (this.needleLabel.element as HTMLDivElement).textContent =
        'İğne + karşı ağırlıklı çatal mil';
      this.needleLabel.position.set(0, -2.38, DIAL_Z);

      this.precHolder.position.set(0, TNS_GIMBAL_Y, 2.25);
      this.precHolder.rotation.x = 0;
    }
  }

  get labelsVisible(): boolean {
    return this.partLabelsVisible;
  }

  private applyLabelVisibility() {
    for (const l of this.partLabels) l.visible = this.partLabelsVisible;
  }

  setLabelsVisible(v: boolean) {
    this.partLabelsVisible = v;
    this.applyLabelVisibility();
  }

  /** Sinematik kamera hedefini ayarlar; null verilirse serbest kameraya döner. */
  setCinematicShot(shot: CinematicShot | null) {
    this.cinematicShot = shot;
    this.cinematicUserPaused = false;
    this.cinematicTime = 0;
  }

  update(m: FlightModel, simDt: number, realDt = 0.016) {
    if (this.cinematicShot && !this.cinematicUserPaused) {
      this.cinematicTime += realDt;
      const [gx, gy, gz] = this.cinematicShot.pos;
      const [tx, ty, tz] = this.cinematicShot.target;
      const drift = this.cinematicShot.drift ?? 0.35;
      // Hafif sinematik salınım (kamera odak noktası etrafında canlı nefes alma hareketi yapar)
      const dx = Math.sin(this.cinematicTime * 0.65) * drift;
      const dy = Math.cos(this.cinematicTime * 0.45) * (drift * 0.35);
      const dz = Math.cos(this.cinematicTime * 0.55) * (drift * 0.6);

      this.camGoalPos.set(gx + dx, gy + dy, gz + dz);
      this.camGoalTarget.set(tx, ty, tz);

      const alpha = 1 - Math.exp(-realDt * 3.2);
      this.camera.position.lerp(this.camGoalPos, alpha);
      this.controls.target.lerp(this.camGoalTarget, alpha);
    }
    this.controls.update();

    const isTC = this.type === 'tc';
    const signal = isTC ? m.tcSignal : m.tnsSignal;
    const needleAngle = signalToAngle(signal); // Pozitif = sağ dönüş
    const needleRad = needleAngle * DEG;

    // 1. 3B İnklinometre bilyesi: kavisli cam tüp içinde hareket eder
    const ba = clamp(m.ballPos * 0.9, -13.5, 13.5) * DEG;
    this.ball.position.x = BALL_ARC_R * Math.sin(ba);
    this.ball.position.y = this.ballYc - BALL_ARC_R * Math.cos(ba);

    // 2. Turn & Slip mekanizması kinematiği
    // Çatal-pim tam temas bağıntısı: TNS_ARM_R * sin(gimbalRad) = TNS_FORK_L * sin(needleRad)
    const sinGimbalTns = clamp((TNS_FORK_L / TNS_ARM_R) * Math.sin(needleRad), -0.85, 0.85);
    const tnsGimbalRad = Math.asin(sinGimbalTns);
    this.tnsGimbal.rotation.z = tnsGimbalRad;
    this.tnsPointerGroup.rotation.z = -needleRad;
    this.tnsRotor.rotation.x -= ROTOR_VIS_SPIN * simDt;

    // T&S kalibrasyon yayı ve dashpot piston-kolu güncellemesi
    this.scene.updateMatrixWorld();
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();

    this.tnsSpringAttach.getWorldPosition(pA);
    placeBetween(this.tnsSpringMesh, this.tnsSpringAnchor, pA);

    this.tnsDashArmTip.getWorldPosition(pA);
    const pistonY = clamp(0.98 + (pA.y - TNS_GIMBAL_Y) * 0.95, 0.76, 1.32);
    this.tnsDashPiston.position.y = pistonY;
    pB.set(this.tnsDashPiston.position.x, pistonY - 0.08, this.tnsDashPiston.position.z);
    placeBetween(this.tnsDashRod, pA, pB);

    // 3. Turn Coordinator mekanizması kinematiği
    // Sektör dişli ve pinyon kavraşması: gimbal +z yönünde yatarken pinyon -z yönünde döner
    const tcGimbalRad = needleRad * TC_GEAR_RATIO;
    this.tcGimbal.rotation.z = tcGimbalRad;
    this.tcPinionGroup.rotation.z = -needleRad;
    this.tcRotor.rotation.x -= ROTOR_VIS_SPIN * simDt;

    this.scene.updateMatrixWorld();
    this.tcSpringAttach.getWorldPosition(pA);
    placeBetween(this.tcSpringMesh, this.tcSpringAnchor, pA);

    // TC cam tüplü damper: krank pimi hareket ettikçe grafit piston cam tüp içinde kayar
    this.tcDashCrank.getWorldPosition(pA);
    const pistonLocalY = clamp(-0.06 - Math.sin(tcGimbalRad) * 0.65, -0.32, 0.24);
    this.tcDashPiston.position.set(0, pistonLocalY, 0);
    this.tcGlassDashGroup.updateMatrixWorld();
    this.tcDashPiston.getWorldPosition(pB);
    placeBetween(this.tcDashRod, pA, pB);

    // 4. Cayro dönüş oku konumu (aktif rotoru takip eder)
    if (isTC) {
      this.tcRotor.getWorldPosition(pA);
      this.spinHolder.position.copy(pA).add(new THREE.Vector3(-1.32, 0, 0));
      this.spinHolder.rotation.x = TC_CANT * DEG;
      this.spinHolder.rotation.z = tcGimbalRad;
    } else {
      this.tnsRotor.getWorldPosition(pA);
      this.spinHolder.position.copy(pA).add(new THREE.Vector3(-1.32, 0, 0));
      this.spinHolder.rotation.set(0, 0, tnsGimbalRad);
    }

    // 5. Dinamik hareket okları (yaw, roll, presesyon) her zaman harekete bağlı görünür
    const yaw = m.yawRate;
    const showYaw = Math.abs(yaw) > 0.15;
    this.yawArrow.group.visible = showYaw;
    this.yawLabel.visible = showYaw;
    this.yawArrow.group.scale.x = yaw > 0 ? -1 : 1;
    this.yawArrow.mat.opacity = Math.min(1, 0.35 + Math.abs(yaw) / 4);

    const p = m.rollRate;
    const showRoll = Math.abs(p) > 0.3;
    this.rollArrow.group.visible = showRoll;
    this.rollLabel.visible = showRoll;
    this.rollArrow.group.scale.x = p > 0 ? -1 : 1;
    this.rollArrow.mat.opacity = Math.min(1, 0.35 + Math.abs(p) / 6);

    const activeTiltDeg = (isTC ? tcGimbalRad : tnsGimbalRad) / DEG;
    const showPrec = Math.abs(activeTiltDeg) > 0.6;
    this.precArrow.group.visible = showPrec;
    this.precLabel.visible = showPrec;
    this.precArrow.group.scale.x = activeTiltDeg > 0 ? 1 : -1;
  }
}
