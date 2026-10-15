import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { DEG, FlightModel, TC_CANT } from './physics';
import { signalToAngle, STD_MARK_DEG } from './gauges';

export type MechType = 'tns' | 'tc';

const ROTOR_VIS_SPIN = 9; // rad/s, gözle takip edilebilir görsel hız
const GIMBAL_GAIN = 0.75; // gimbal yatması = iğne sapması × kazanç
const DIAL_Z = 3.4;

function label(text: string, cls = '') {
  const div = document.createElement('div');
  div.className = `label3d ${cls}`;
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
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: true });
  const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 48, arc), mat);
  inner.add(torus);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.2, tube * 7, 12), mat);
  cone.position.set(radius * Math.cos(arc), radius * Math.sin(arc), 0);
  cone.rotation.z = arc;
  inner.add(cone);
  return { group: g, mat };
}

function dialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#18181a';
  x.beginPath();
  x.arc(256, 256, 256, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#555';
  x.lineWidth = 14;
  x.stroke();
  x.fillStyle = '#f2f2f2';
  for (const d of [-STD_MARK_DEG, 0, STD_MARK_DEG]) {
    x.save();
    x.translate(256, 256);
    x.rotate(d * DEG);
    x.fillRect(-12, -225, 24, 42);
    x.restore();
  }
  x.font = 'bold 70px system-ui, sans-serif';
  x.textAlign = 'center';
  x.fillText('L', 140, 180);
  x.fillText('R', 372, 180);
  x.font = 'bold 40px system-ui, sans-serif';
  x.fillText('2 MIN', 256, 420);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MechanismView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  readonly controls: OrbitControls;
  type: MechType = 'tns';

  private cant = new THREE.Group();
  private gimbal = new THREE.Group();
  private rotor: THREE.Mesh;
  private needle = new THREE.Group();
  private crank = new THREE.Object3D();
  private leverTip = new THREE.Object3D();
  private rod: THREE.Mesh;
  private rodLabel: CSS2DObject;
  private axisLabel: CSS2DObject;
  private axisLabelDiv: HTMLDivElement;
  private currentCant = 0;

  private spinArrow: ReturnType<typeof curvedArrow>;
  private yawArrow: ReturnType<typeof curvedArrow>;
  private rollArrow: ReturnType<typeof curvedArrow>;
  private precArrow: ReturnType<typeof curvedArrow>;
  private yawLabel: CSS2DObject;
  private rollLabel: CSS2DObject;
  private precLabel: CSS2DObject;
  private labels: CSS2DObject[] = [];

  constructor(dom: HTMLElement) {
    const s = this.scene;
    s.background = new THREE.Color(0x15191f);
    s.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(6, 10, 8);
    s.add(key);

    this.camera.position.set(8.5, 4.2, 6.5);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.target.set(0, 0, 0.6);
    this.controls.enableDamping = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 25;
    this.controls.update();

    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a45a, metalness: 0.75, roughness: 0.35 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.2, roughness: 0.6 });

    // Kasa (şeffaf silindir) ve taban
    const caseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 6.6, 40, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    caseMesh.position.z = 0.1;
    s.add(caseMesh);
    for (const z of [-3.2, 3.4]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.04, 6, 60), new THREE.MeshBasicMaterial({ color: 0x5a6a7a }));
      ring.position.z = z;
      s.add(ring);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 5.6), darkMat);
    base.position.set(0, -2.2, 0);
    s.add(base);

    // Eğim grubu (TC'de 30°), içinde yataklar + gimbal
    s.add(this.cant);
    for (const z of [-2.2, 2.2]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.25), darkMat);
      support.position.set(0, -1.1, z);
      this.cant.add(support);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 12).rotateX(Math.PI / 2), steel);
      pin.position.set(0, 0, z * 0.93);
      this.cant.add(pin);
    }
    // Gimbal ekseni (kesikli çizgi)
    const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -3.6), new THREE.Vector3(0, 0, 3.0)]);
    const axisLine = new THREE.Line(axisGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12 }));
    axisLine.computeLineDistances();
    this.cant.add(axisLine);
    this.axisLabel = label('Gimbal ekseni (boyuna eksen)', 'axis');
    this.axisLabelDiv = this.axisLabel.element as HTMLDivElement;
    this.axisLabel.position.set(0, 0.25, -3.6);
    this.cant.add(this.axisLabel);

    // Gimbal çerçevesi (x-z düzleminde dikdörtgen)
    this.cant.add(this.gimbal);
    const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), brass);
      b.position.set(x, y, z);
      this.gimbal.add(b);
    };
    bar(0.16, 0.22, 3.75, 0.85, 0, 0);
    bar(0.16, 0.22, 3.75, -0.85, 0, 0);
    bar(1.86, 0.22, 0.16, 0, 0, 1.8);
    bar(1.86, 0.22, 0.16, 0, 0, -1.8);
    // Rotor mili (yanal eksen)
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.7, 10).rotateZ(Math.PI / 2), steel);
    this.gimbal.add(axle);
    // İğneye giden kol
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), brass);
    lever.position.set(0, 0.5, 1.8);
    this.gimbal.add(lever);
    this.leverTip.position.set(0, 1.0, 1.8);
    this.gimbal.add(this.leverTip);

    // Rotor: dönen disk (mil yanal eksende = x)
    const rotorGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.38, 48).rotateZ(Math.PI / 2);
    this.rotor = new THREE.Mesh(rotorGeo, new THREE.MeshStandardMaterial({ color: 0xd4af62, metalness: 0.8, roughness: 0.3 }));
    // Dönüşü görünür kılan işaretler
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.22, 0.22),
        new THREE.MeshStandardMaterial({ color: i === 0 ? 0xe03030 : 0x333333 }),
      );
      mark.position.set(0, Math.cos(a) * 1.0, Math.sin(a) * 1.0);
      this.rotor.add(mark);
    }
    this.gimbal.add(this.rotor);
    const rotorLabel = label('Rotor (gyro)');
    rotorLabel.position.set(0, 1.55, -0.6);
    this.gimbal.add(rotorLabel);

    // Rotor dönüş oku (mavi): rotorun açısal momentumu -x yönünde
    this.spinArrow = curvedArrow(0.95, Math.PI * 1.3, 0x3fa0ff);
    this.spinArrow.group.rotation.y = Math.PI / 2;
    this.spinArrow.group.position.x = -1.15;
    this.spinArrow.group.scale.x = -1;
    this.gimbal.add(this.spinArrow.group);
    const spinLabel = label('Gyro dönüşü', 'blue');
    spinLabel.position.set(-1.3, -1.2, 0);
    this.gimbal.add(spinLabel);

    // Presesyon oku (turuncu): gimbal ekseni etrafında
    this.precArrow = curvedArrow(1.75, Math.PI * 0.55, 0xff8a1f, 0.065);
    this.precArrow.group.position.z = 2.45;
    this.cant.add(this.precArrow.group);
    this.precLabel = label('Presesyon → gimbal yatar', 'orange');
    this.precLabel.position.set(0, 2.0, 2.45);
    this.cant.add(this.precLabel);

    // Uçak yaw oku (kırmızı): dikey eksen etrafında, kasaya bağlı
    this.yawArrow = curvedArrow(1.5, Math.PI * 1.2, 0xff4040, 0.065);
    const yawHolder = new THREE.Group();
    yawHolder.position.y = 3.1;
    yawHolder.add(this.yawArrow.group);
    this.yawArrow.group.rotation.x = -Math.PI / 2;
    s.add(yawHolder);
    this.yawLabel = label('Uçak yaw dönüşü', 'red');
    this.yawLabel.position.set(0, 3.5, 0);
    s.add(this.yawLabel);

    // Uçak roll oku (mor): boyuna eksen etrafında, ön tarafta
    this.rollArrow = curvedArrow(2.1, Math.PI * 0.7, 0xb46cff, 0.065);
    const rollHolder = new THREE.Group();
    rollHolder.position.z = -3.6;
    rollHolder.add(this.rollArrow.group);
    s.add(rollHolder);
    this.rollLabel = label('Uçak roll dönüşü', 'purple');
    this.rollLabel.position.set(0, 2.5, -3.6);
    s.add(this.rollLabel);

    // Gösterge kadranı ve iğne (pilot tarafı, +z)
    const dial = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 48),
      new THREE.MeshBasicMaterial({ map: dialTexture(), transparent: true, opacity: 0.92 }),
    );
    dial.position.z = DIAL_Z;
    s.add(dial);
    this.needle.position.set(0, 0, DIAL_Z + 0.05);
    const needleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.65, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    needleMesh.position.y = 0.82;
    this.needle.add(needleMesh);
    const crankMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.04), steel);
    crankMesh.position.y = -0.27;
    this.needle.add(crankMesh);
    this.crank.position.set(0, -0.55, -0.05);
    this.needle.add(this.crank);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16).rotateX(Math.PI / 2), darkMat);
    this.needle.add(hub);
    s.add(this.needle);
    const needleLabel = label('İğne (ters yönde döner)');
    needleLabel.position.set(0, -2.35, DIAL_Z);
    s.add(needleLabel);

    // Bağlantı çubuğu
    this.rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), steel);
    s.add(this.rod);
    this.rodLabel = label('Bağlantı çubuğu');
    s.add(this.rodLabel);

    this.scene.traverse((o) => {
      if (o instanceof CSS2DObject) this.labels.push(o);
    });
  }

  setType(t: MechType) {
    this.type = t;
    this.axisLabelDiv.textContent =
      t === 'tc' ? `Gimbal ekseni ${TC_CANT}° yukarı eğik → roll da algılanır` : 'Gimbal ekseni (boyuna eksen)';
  }

  setLabelsVisible(v: boolean) {
    for (const l of this.labels) l.visible = v;
  }

  update(m: FlightModel, simDt: number) {
    this.controls.update();

    const targetCant = this.type === 'tc' ? TC_CANT : 0;
    this.currentCant += (targetCant - this.currentCant) * (1 - Math.exp(-simDt * 4 - 0.02));
    // Eğim: ön uç yukarı
    this.cant.rotation.x = this.currentCant * DEG;

    const signal = this.type === 'tc' ? m.tcSignal : m.tnsSignal;
    const needleAngle = signalToAngle(signal); // pozitif = sağa
    // Sağ dönüşte rotorun üstü sola yatar (+z dönüşü), iğne bağlantı ile sağa gider
    this.gimbal.rotation.z = needleAngle * GIMBAL_GAIN * DEG;
    this.needle.rotation.z = -needleAngle * DEG;
    this.rotor.rotation.x -= ROTOR_VIS_SPIN * simDt;

    // Bağlantı çubuğu: kol ucu -> iğne krankı
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.scene.updateMatrixWorld();
    this.leverTip.getWorldPosition(a);
    this.crank.getWorldPosition(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const d = b.clone().sub(a);
    this.rod.position.copy(mid);
    this.rod.scale.set(1, d.length(), 1);
    this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.rodLabel.position.copy(mid).add(new THREE.Vector3(0.9, 0, 0));

    // Oklar: yön ve görünürlük
    const yaw = m.yawRate;
    this.yawArrow.group.visible = Math.abs(yaw) > 0.15;
    this.yawLabel.visible = this.yawArrow.group.visible;
    this.yawArrow.group.scale.x = yaw > 0 ? -1 : 1; // sağ dönüş = yukarıdan saat yönü
    this.yawArrow.mat.opacity = Math.min(1, 0.35 + Math.abs(yaw) / 4);

    const p = m.rollRate;
    this.rollArrow.group.visible = Math.abs(p) > 0.3;
    this.rollLabel.visible = this.rollArrow.group.visible;
    this.rollArrow.group.scale.x = p > 0 ? -1 : 1;
    this.rollArrow.mat.opacity = Math.min(1, 0.35 + Math.abs(p) / 6);

    const tilt = this.gimbal.rotation.z / DEG;
    this.precArrow.group.visible = Math.abs(tilt) > 0.8;
    this.precLabel.visible = this.precArrow.group.visible;
    this.precArrow.group.scale.x = tilt > 0 ? 1 : -1;
  }
}
