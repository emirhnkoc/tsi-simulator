import * as THREE from 'three';
import { DEG, FlightModel, clamp } from './physics';

/** 1 sahne birimi = 40 m. Standart dönüş yarıçapı 100 kt'ta ~1 km, yani ~25 birim. */
const WORLD_SCALE = 1 / 40;
const ALT = 14;
const SKY = 0x8fb7dc;
const TRAIL_MAX = 5000;

// ---- Kontrol yüzeyleri (tamamı görsel; fizik modeli değişmez) ----
const AILERON_MAX = 22; // °, tam yatış komutunda
const ELEVATOR_MAX = 20; // °, dönüşteki back-pressure
const RUDDER_MAX = 25; // °, tam rudder girdisinde
const FLAP_MAX = 25; // °
const FLAP_UP_KT = 85; // bu süratin altında flaplar kademesiz iner
const FLAP_FULL_KT = 62;
/** Kanat dihedral açısı. */
const DIHEDRAL = 2.5;
const TAN_D = Math.tan(DIHEDRAL * DEG);

export type CamMode = 'chase' | 'top';

/** İki nokta arasına çubuk (strudel, iniş takımı bacağı) yerleştirir. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 6), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** Gövde profili: [yarıçap, burundan uzaklık (0 = burun ucu)]. */
const FUSELAGE: [number, number][] = [
  [0.03, 0.0],
  [0.19, 0.14],
  [0.30, 0.38],
  [0.40, 0.95],
  [0.385, 1.25],
  [0.42, 1.45],
  [0.42, 2.35],
  [0.34, 3.0],
  [0.24, 3.9],
  [0.14, 4.7],
  [0.05, 5.2],
];

/** x ekseninde aynalı bir şekli, ±90° döndürüp X kalınlığını ortalayarak kuyruk yüzeyi yapar. */
function extrudedPanel(shape: THREE.Shape, depth: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); // şekil +x -> +z (arka), kalınlık -x
  geo.translate(depth / 2, 0, 0);
  return new THREE.Mesh(geo, mat);
}

function buildAircraft() {
  // group: konum + yaw (heading/sideslip) — body: pitch + bank
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paint = (color: number, rough = 0.45) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  const white = paint(0xf2f3f5);
  const red = paint(0xc8202a, 0.4);
  const glass = new THREE.MeshStandardMaterial({ color: 0x16222e, roughness: 0.15, metalness: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6b7076, roughness: 0.35, metalness: 0.6 });
  const dark = paint(0x22262b, 0.6);
  const yellow = paint(0xf5c518, 0.5);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const navRed = new THREE.MeshStandardMaterial({ color: 0x3a0b0b, emissive: 0xff2222, emissiveIntensity: 1.6 });
  const navGreen = new THREE.MeshStandardMaterial({ color: 0x0b3a12, emissive: 0x22ff44, emissiveIntensity: 1.6 });
  const navWhite = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, emissive: 0xffffff, emissiveIntensity: 1.1 });
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x3a0b0b, emissive: 0xff1111, emissiveIntensity: 2 });

  // ---- Gövde: lathe (dönel) profil, burun -z ----
  const fusGeo = new THREE.LatheGeometry(
    FUSELAGE.map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  );
  fusGeo.rotateX(Math.PI / 2); // +y -> +z
  const fus = new THREE.Mesh(fusGeo, white);
  fus.position.z = -2.6;
  body.add(fus);

  // Kuyruk konisi ucu
  const tailCap = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), white);
  tailCap.position.set(0, 0, 2.6);
  body.add(tailCap);

  // Kırmızı gövde şeridi (gövdeye oturan ince lathe bandı)
  const stripe: THREE.Vector2[] = [
    [0.408, 1.10],
    [0.395, 1.30],
    [0.428, 1.50],
    [0.428, 2.40],
    [0.373, 2.90],
    [0.343, 3.10],
  ].map(([r, y]) => new THREE.Vector2(r + 0.008, y));
  const stripeGeo = new THREE.LatheGeometry(stripe, 20);
  stripeGeo.rotateX(Math.PI / 2);
  const stripeMesh = new THREE.Mesh(stripeGeo, red);
  stripeMesh.position.z = -2.6;
  body.add(stripeMesh);

  // ---- Burun: spinner, pervane, hava girişi ----
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.45, 12).rotateX(-Math.PI / 2), red);
  spinner.position.z = -2.80;
  body.add(spinner);

  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.10), dark);
  intake.position.set(0, -0.15, -2.52);
  body.add(intake);

  const prop = new THREE.Group();
  prop.position.z = -2.58;
  for (const s of [1, -1]) {
    const bladeGroup = new THREE.Group();
    bladeGroup.rotation.z = s === 1 ? 0 : Math.PI;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.56, 0.045), dark);
    blade.position.y = 0.78;
    bladeGroup.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.05), yellow);
    tip.position.y = 1.47;
    bladeGroup.add(tip);
    prop.add(bladeGroup);
  }
  body.add(prop);

  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 20),
    new THREE.MeshBasicMaterial({ color: 0xcdd4da, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  propDisc.position.z = -2.57;
  body.add(propDisc);

  // ---- Kabin camları ----
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 1.10), glass);
  canopy.position.set(0, 0.40, -0.85);
  body.add(canopy);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), glass);
  windshield.position.set(0, 0.43, -1.52);
  windshield.rotation.x = -0.49;
  body.add(windshield);

  // ---- Kanat: iki yarı (uçlarda dihedral), aileron + flap hareketli ----
  const wingY = (x: number) => 0.63 + Math.abs(x) * TAN_D;

  /** Yarı kanat: gövdeye x=0'dan bağlı, uca doğru 3.95 birim. */
  const buildWingHalf = (s: 1 | -1) => {
    const sh = new THREE.Shape();
    // CCW sırası: hücum kenarı -> uç -> arka kenar (sağ için +x, sol aynalanır)
    if (s === 1) {
      sh.moveTo(0, -0.56);
      sh.lineTo(3.55, -0.56);
      sh.quadraticCurveTo(3.95, -0.50, 3.95, 0);
      sh.quadraticCurveTo(3.95, 0.50, 3.55, 0.56);
      sh.lineTo(0, 0.56);
    } else {
      sh.moveTo(0, 0.56);
      sh.lineTo(-3.55, 0.56);
      sh.quadraticCurveTo(-3.95, 0.50, -3.95, 0);
      sh.quadraticCurveTo(-3.95, -0.50, -3.55, -0.56);
      sh.lineTo(0, -0.56);
    }
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.13, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // şekil +y -> +z (arka), kalınlık y'de ortalanır
    geo.translate(0, 0.065, 0);

    const g = new THREE.Group();
    g.position.set(0, 0.63, -0.50);
    g.rotation.z = s * DIHEDRAL * DEG;
    g.add(new THREE.Mesh(geo, white));

    // Kontrol yüzeyi: menteşe kanat arka kenarında (yerel z=0.50)
    const surface = (xHinge: number, span: number, chord: number, thick: number): THREE.Group => {
      const pivot = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(span, thick, chord), white);
      mesh.position.set((s * span) / 2, 0, chord / 2);
      pivot.add(mesh);
      pivot.position.set(s * xHinge, 0, 0.50);
      return pivot;
    };
    const aileron = surface(1.85, 1.55, 0.34, 0.085);
    const flap = surface(0.30, 1.35, 0.36, 0.095);
    g.add(aileron, flap);

    // Uç: kırmızı boya + seyrüsefer lambası (sol kırmızı, sağ yeşil)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.145, 0.80), red);
    cap.position.set(s * 3.78, 0, 0);
    g.add(cap);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), s < 0 ? navRed : navGreen);
    nav.position.set(s * 3.96, 0.02, -0.10);
    g.add(nav);

    return { group: g, aileron, flap };
  };

  const wingR = buildWingHalf(1);
  const wingL = buildWingHalf(-1);
  body.add(wingR.group, wingL.group);

  // Kanat dikmeleri
  for (const s of [-1, 1]) {
    body.add(
      strut(
        new THREE.Vector3(s * 0.30, -0.30, -0.55),
        new THREE.Vector3(s * 1.30, wingY(1.30) - 0.065, -0.55),
        0.035,
        metal,
      ),
    );
  }

  // ---- İniş takımı ----
  for (const s of [-1, 1]) {
    body.add(
      strut(new THREE.Vector3(s * 0.40, -0.28, -0.25), new THREE.Vector3(s * 0.93, -1.02, -0.32), 0.045, metal),
    );
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.13, 12).rotateZ(Math.PI / 2), tyre);
    wheel.position.set(s * 0.95, -1.10, -0.32);
    body.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.15, 8).rotateZ(Math.PI / 2), metal);
    hub.position.copy(wheel.position);
    body.add(hub);
  }
  body.add(strut(new THREE.Vector3(0, -0.30, -1.80), new THREE.Vector3(0, -1.02, -1.85), 0.04, metal));
  const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.11, 12).rotateZ(Math.PI / 2), tyre);
  noseWheel.position.set(0, -1.10, -1.85);
  body.add(noseWheel);
  const noseHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.13, 8).rotateZ(Math.PI / 2), metal);
  noseHub.position.copy(noseWheel.position);
  body.add(noseHub);

  // ---- Kuyruk: yatay stabilize + elevatör ----
  const hstab = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.075, 0.64), white);
  hstab.position.set(0, 0.10, 2.32);
  body.add(hstab);

  const elevatorPivot = new THREE.Group();
  elevatorPivot.position.set(0, 0.10, 2.58);
  const elevator = new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.055, 0.32), white);
  elevator.position.set(0, 0, 0.16);
  elevatorPivot.add(elevator);
  body.add(elevatorPivot);

  // ---- Dikey stabilize + rudder ----
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.95, 0);
  finShape.lineTo(0.95, 1.02);
  finShape.lineTo(0.55, 1.02);
  finShape.closePath();
  const fin = extrudedPanel(finShape, 0.07, white);
  fin.position.set(0, 0.15, 1.95);
  body.add(fin);

  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0, 0);
  dorsalShape.lineTo(0.5, 0);
  dorsalShape.lineTo(0, 0.30);
  dorsalShape.closePath();
  const dorsal = extrudedPanel(dorsalShape, 0.05, white);
  dorsal.position.set(0, 0.18, 1.70);
  body.add(dorsal);

  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, 0.15, 2.90);
  const rudderShape = new THREE.Shape();
  rudderShape.moveTo(0, 0);
  rudderShape.lineTo(0.32, 0);
  rudderShape.lineTo(0.30, 1.0);
  rudderShape.lineTo(0, 1.02);
  rudderShape.closePath();
  const rudder = extrudedPanel(rudderShape, 0.06, white);
  rudderPivot.add(rudder);
  const tailNav = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), navWhite);
  tailNav.position.set(0, 1.0, 0.28);
  rudderPivot.add(tailNav);
  body.add(rudderPivot);

  // Kırmızı ikaz feneri (fin tepesi) — yanıp söner
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), beaconMat);
  beacon.position.set(0, 1.20, 2.70);
  body.add(beacon);

  return {
    group,
    body,
    prop,
    propDisc,
    aileronL: wingL.aileron,
    aileronR: wingR.aileron,
    elevator: elevatorPivot,
    rudder: rudderPivot,
    flapL: wingL.flap,
    flapR: wingR.flap,
    beacon,
  };
}

export class AircraftView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
  camMode: CamMode = 'chase';

  private plane: THREE.Group;
  private body: THREE.Group;
  private prop: THREE.Group;
  private propDisc: THREE.Mesh;
  private aileronL: THREE.Object3D;
  private aileronR: THREE.Object3D;
  private elevator: THREE.Object3D;
  private rudder: THREE.Object3D;
  private flapL: THREE.Object3D;
  private flapR: THREE.Object3D;
  private beacon: THREE.Mesh;
  private flapPos = 0;
  private clockT = 0;
  private trackArrow: THREE.ArrowHelper;
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;
  private trailGeo: THREE.BufferGeometry;
  private trailPos: Float32Array;
  private trailCount = 0;
  private trailTimer = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(SKY);
    s.fog = new THREE.Fog(SKY, 120, 650);

    s.add(new THREE.HemisphereLight(0xdfefff, 0x4a6040, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 100, 30);
    s.add(sun);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x6d8f52 }),
    );
    s.add(this.ground);
    this.grid = new THREE.GridHelper(800, 80, 0x4f6b3a, 0x5d7c46);
    this.grid.position.y = 0.02;
    s.add(this.grid);

    // Yer referansı için rastgele ağaçlar (hareket hissi)
    const treeGeo = new THREE.ConeGeometry(1.2, 4, 6);
    treeGeo.translate(0, 2, 0);
    const trees = new THREE.InstancedMesh(
      treeGeo,
      new THREE.MeshLambertMaterial({ color: 0x2f5a2a, flatShading: true }),
      700,
    );
    const m = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      const sc = 0.6 + rnd() * 1.2;
      m.makeScale(sc, sc, sc);
      m.setPosition((rnd() - 0.5) * 1200, 0, (rnd() - 0.5) * 1200);
      trees.setMatrixAt(i, m);
    }
    s.add(trees);

    const ac = buildAircraft();
    this.plane = ac.group;
    this.body = ac.body;
    this.prop = ac.prop;
    this.propDisc = ac.propDisc;
    this.aileronL = ac.aileronL;
    this.aileronR = ac.aileronR;
    this.elevator = ac.elevator;
    this.rudder = ac.rudder;
    this.flapL = ac.flapL;
    this.flapR = ac.flapR;
    this.beacon = ac.beacon;
    s.add(this.plane);

    // Uçuş yolu yönü (sarı ok): slip/skid'de burun bu oktan sapar
    this.trackArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 7, 0xffd400, 1.2, 0.6);
    s.add(this.trackArrow);

    this.trailPos = new Float32Array(TRAIL_MAX * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    trail.frustumCulled = false;
    s.add(trail);
  }

  setCamMode(mode: CamMode) {
    this.camMode = mode;
  }

  resetTrail() {
    this.trailCount = 0;
    this.trailGeo.setDrawRange(0, 0);
  }

  update(m: FlightModel, simDt: number, realDt: number) {
    const px = m.x * WORLD_SCALE;
    const pz = m.z * WORLD_SCALE;
    const pos = new THREE.Vector3(px, ALT, pz);
    this.plane.position.copy(pos);
    this.plane.rotation.y = -(m.heading + m.sideslipDeg * DEG);

    // ---- Kontrol yüzeyleri ----
    // Aileronlar: yatış komutu + roll hızı. Sağa yatışta sağ aileron yukarı, sol aşağı.
    const ailCmd = clamp((m.target.bank - m.bank) / 8 + m.rollRate / 12, -1, 1);
    const ail = ailCmd * AILERON_MAX * DEG;
    this.aileronR.rotation.x = -ail;
    this.aileronL.rotation.x = ail;

    // Elevatör: dönüşte yük faktörü kadar back-pressure (n = 1/cosφ)
    const n = 1 / Math.max(Math.cos(m.bank * DEG), 0.2);
    const back = clamp((n - 1) * 45, 0, ELEVATOR_MAX);
    this.elevator.rotation.x = -back * DEG; // TE yukarı = burun yukarı
    this.body.rotation.x = back * 0.45 * DEG; // görsel yunuslama (hücum açısı hissi)

    // Rudder: pilot girdisi kadar sapar
    this.rudder.rotation.y = m.rudder * RUDDER_MAX * DEG;

    // Flaplar: düşük süratte kademesiz iner
    const flapTarget = clamp((FLAP_UP_KT - m.speed) / (FLAP_UP_KT - FLAP_FULL_KT), 0, 1) * FLAP_MAX;
    this.flapPos += (flapTarget - this.flapPos) * (1 - Math.exp(-realDt * 2.5));
    this.flapL.rotation.x = this.flapPos * DEG;
    this.flapR.rotation.x = this.flapPos * DEG;

    // Bank (roll) ve yunuslama gövde grubunda
    this.body.rotation.z = -m.bank * DEG;

    // Pervane + yanıp sönen ikaz feneri
    this.prop.rotation.z += simDt * (30 + m.speed * 0.35);
    this.propDisc.visible = simDt > 0;
    this.clockT += realDt;
    this.beacon.visible = this.clockT % 1.6 < 0.12;

    const dir = new THREE.Vector3(Math.sin(m.heading), 0, -Math.cos(m.heading));
    this.trackArrow.position.copy(pos);
    this.trackArrow.setDirection(dir);

    this.ground.position.set(px, 0, pz);
    this.grid.position.set(Math.round(px / 10) * 10, 0.02, Math.round(pz / 10) * 10);

    // İz
    this.trailTimer += simDt;
    if (this.trailTimer > 0.15 || this.trailCount === 0) {
      this.trailTimer = 0;
      if (this.trailCount >= TRAIL_MAX) {
        this.trailPos.copyWithin(0, 3);
        this.trailCount--;
      }
      const i = this.trailCount * 3;
      this.trailPos[i] = px;
      this.trailPos[i + 1] = ALT;
      this.trailPos[i + 2] = pz;
      this.trailCount++;
      this.trailGeo.setDrawRange(0, this.trailCount);
      (this.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // Kamera
    let wantPos: THREE.Vector3;
    let wantLook: THREE.Vector3;
    if (this.camMode === 'chase') {
      wantPos = pos.clone().addScaledVector(dir, -13).add(new THREE.Vector3(0, 3.8, 0));
      wantLook = pos.clone().addScaledVector(dir, 4);
      this.camera.up.set(0, 1, 0);
    } else {
      wantPos = pos.clone().add(new THREE.Vector3(0, 75, 0.01));
      wantLook = pos.clone();
      this.camera.up.set(0, 0, -1);
    }
    const k = this.camInit ? 1 - Math.exp(-realDt * 3) : 1;
    this.camInit = true;
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }
}
