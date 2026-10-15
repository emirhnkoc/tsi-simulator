import * as THREE from 'three';
import { DEG, FlightModel } from './physics';

/** 1 sahne birimi = 40 m. Standart dönüş yarıçapı 100 kt'ta ~1 km, yani ~25 birim. */
const WORLD_SCALE = 1 / 40;
const ALT = 14;
const SKY = 0x8fb7dc;
const TRAIL_MAX = 5000;

export type CamMode = 'chase' | 'top';

function buildAircraft() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, flatShading: true, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8202a, flatShading: true, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2733, flatShading: true, roughness: 0.3 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x555555, flatShading: true });

  // Gövde: burun -z yönünde
  const fusGeo = new THREE.CylinderGeometry(0.22, 0.48, 4.2, 8);
  fusGeo.rotateX(Math.PI / 2); // +y -> +z (ince kuyruk arkada)
  const fus = new THREE.Mesh(fusGeo, white);
  fus.position.z = 0.4;
  g.add(fus);

  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.42, 0.7, 8).rotateX(Math.PI / 2), white);
  cowl.position.z = -2.0;
  g.add(cowl);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8).rotateX(-Math.PI / 2), red);
  spinner.position.z = -2.55;
  g.add(spinner);

  const prop = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.04), grey);
  prop.add(blade);
  prop.position.z = -2.45;
  g.add(prop);

  // Kabin camları
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.45, 1.3), dark);
  cabin.position.set(0, 0.32, -0.9);
  g.add(cabin);

  // Yüksek kanat
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 1.0), white);
  wing.position.set(0, 0.62, -0.75);
  g.add(wing);
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 1.02), red);
    tip.position.set(s * 3.5, 0.62, -0.75);
    g.add(tip);
    // Kanat dikmesi
    const strutLen = 2.3;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, strutLen, 5), grey);
    strut.position.set(s * 1.25, 0.12, -0.7);
    strut.rotation.z = s * 1.1;
    g.add(strut);
    // İniş takımı
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5), grey);
    leg.position.set(s * 0.55, -0.62, -0.5);
    leg.rotation.z = s * 0.6;
    g.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10).rotateZ(Math.PI / 2), dark);
    wheel.position.set(s * 0.82, -1.0, -0.5);
    g.add(wheel);
  }
  const noseWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10).rotateZ(Math.PI / 2), dark);
  noseWheel.position.set(0, -0.85, -2.0);
  g.add(noseWheel);

  // Kuyruk
  const hstab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.07, 0.65), white);
  hstab.position.set(0, 0.15, 2.3);
  g.add(hstab);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.75), red);
  fin.position.set(0, 0.65, 2.3);
  g.add(fin);

  // Gövde şeridi
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 3.0), red);
  stripe.position.set(0, -0.05, 0.4);
  g.add(stripe);

  return { group: g, prop };
}

export class AircraftView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
  camMode: CamMode = 'chase';

  private plane: THREE.Group;
  private prop: THREE.Object3D;
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
    this.plane.rotation.order = 'YXZ';
    this.prop = ac.prop;
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
    this.plane.rotation.z = -m.bank * DEG;
    this.prop.rotation.z += simDt * 40;

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
