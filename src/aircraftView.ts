import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEG, FlightModel, SIDESLIP_PER_RUDDER, clamp } from './physics';

/** 1 sahne birimi = 40 m. Standart dönüş yarıçapı 100 kt'ta ~1 km, yani ~25 birim. */
const WORLD_SCALE = 1 / 40;
const ALT = 22;
const SKY_ZENITH = 0x1b6ee0;
const SKY_MID = 0x5ab2ff;
const SKY_HORIZON = 0xe4f5ff;
const TRAIL_MAX = 5000;

// ---- 3B Dünya & Doğal Çevre Sabitleri ----
const SCENERY_SIZE = 1200;
const SCENERY_HALF = SCENERY_SIZE / 2;
const K_WORLD = (Math.PI * 2) / SCENERY_SIZE;
const WATER_Y = 0.0;
const AIRFIELD_X = -68;
const AIRFIELD_Z = -42;
const AIRFIELD_Y = 1.85;
const LAKE_X = 56;
const LAKE_Z = -32;
const BRIDGE_Z = 52;
const WIND_DRIFT = 0.45;

function wrapWorldDelta(d: number): number {
  return d - Math.round(d / SCENERY_SIZE) * SCENERY_SIZE;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Kıvrımlı 3B nehir yatağının merkez X koordinatı (SCENERY_SIZE periyotlu, %100 kesintisiz). */
function getRiverCenterX(wz: number): number {
  return (
    34 +
    Math.sin(wz * K_WORLD + 0.45) * 48 +
    Math.sin(wz * 2 * K_WORLD + 0.65) * 24 +
    Math.cos(wz * 3 * K_WORLD - 0.35) * 14
  );
}

/** Köprünün nehir merkeziyle kesiştiği tam X koordinatı (~100.565). */
const BRIDGE_X = getRiverCenterX(BRIDGE_Z);

/** Batı vadisi boyunca uzanan kırsal yolun merkez X koordinatı. */
function getRoad1CenterX(wz: number): number {
  return -136 + Math.sin(wz * K_WORLD + 0.4) * 34 + Math.cos(wz * 2 * K_WORLD - 0.7) * 14;
}

/**
 * Doğu-Batı kırsal yolunun merkez Z koordinatı:
 * sin(u) - 0.5*sin(2u) fonksiyonu u = 0 (wx = BRIDGE_X) noktasında hem değer (BRIDGE_Z)
 * hem de 1. ve 2. türev olarak sıfırdır; böylece yol 3B taş kemer köprüye %100 düz ve
 * kusursuz hizalı girer, köprü sonrasında ise doğal olarak kıvrılır.
 */
function getRoad2CenterZ(wx: number): number {
  const u = (wx - BRIDGE_X) * K_WORLD;
  return BRIDGE_Z + (Math.sin(u) - 0.5 * Math.sin(2 * u)) * 34;
}

/** Nehir yarı genişliği (göl bölgesinde doğal olarak genişler). */
function getRiverHalfWidth(wx: number, wz: number): { dist: number; halfW: number } {
  const rx = getRiverCenterX(wz);
  const dxRiver = Math.abs(wrapWorldDelta(wx - rx));
  const baseW = 12.0 + Math.sin(wz * 2 * K_WORLD - 0.4) * 3.0 + Math.cos(wz * 5 * K_WORLD) * 1.4;

  // Doğal dağ gölü havzası (nehirle birleşik)
  const dlx = wrapWorldDelta(wx - LAKE_X);
  const dlz = wrapWorldDelta(wz - LAKE_Z);
  const lakeAngle = Math.atan2(dlz, dlx);
  const lakeRad = 36 + Math.sin(lakeAngle * 2 + 0.5) * 5.5 + Math.cos(lakeAngle * 3 - 0.4) * 3.5;
  const dLake = Math.hypot(dlx * 0.92, dlz * 0.78);

  const riverSigned = dxRiver - baseW;
  const lakeSigned = dLake - lakeRad;
  // Yumuşak birleşim (smooth min)
  const h = clamp(0.5 + (0.5 * (lakeSigned - riverSigned)) / 18.0, 0.0, 1.0);
  const signedDist = lakeSigned * (1 - h) + riverSigned * h - 18.0 * h * (1 - h);
  return { dist: signedDist, halfW: baseW };
}

/** Kıvrımlı kırsal asfalt yolların merkez eğrileri (kare ızgara değil, doğal vadi yolu). */
function getRoadDistance(wx: number, wz: number): number {
  const d1 = Math.abs(wrapWorldDelta(wx - getRoad1CenterX(wz)));
  const d2 = Math.abs(wrapWorldDelta(wz - getRoad2CenterZ(wx)));
  return Math.min(d1, d2);
}

/**
 * Gerçek 3B Dünya Topoğrafya Fonksiyonu:
 * Yumuşak çayır tepeleri, yüksek ormanlık sırtlar, oyulmuş 3B nehir kanyonu ve göl yatağı
 * ile tesviye edilmiş havaalanı platosunu tek bir sürekli 3B yüzeyde birleştirir.
 */
function sampleWorldTerrain(wx: number, wz: number): number {
  const x = wx * K_WORLD;
  const z = wz * K_WORLD;

  // Çok oktavlı periyodik 3B tepeler ve vadiler (kare tekrarlama ve sınır dikişi imkansız)
  const h1 =
    Math.sin(x + 0.3) * Math.cos(z - 0.4) * 3.8 +
    Math.sin(x * 2 - z + 1.1) * 2.6 +
    Math.cos(x + z * 2 - 0.7) * 2.2;
  const h2 =
    Math.sin(x * 3 + z * 2 + 0.5) * 1.65 +
    Math.cos(x * 2 - z * 3 - 1.2) * 1.35 +
    Math.sin(x * 5 - z * 4 + 2.0) * 0.95;
  const h3 =
    Math.cos(x * 7 + z * 6 - 0.8) * 0.65 +
    Math.sin(x * 11 - z * 9 + 1.4) * 0.4 +
    Math.cos(x * 17 + z * 13) * 0.22;

  // Nehir vadisinin iki yanında doğal yükselen yeşil dağ sırtları (tam periyodik C^sonsuz geçiş)
  const valleyWall = Math.pow(0.5 - 0.5 * Math.cos(x - 0.15 * Math.sin(z)), 1.35);
  const ridgeDetail = Math.pow(
    clamp(0.5 + 0.32 * Math.sin(x * 2 + z * 3 - 0.6) + 0.28 * Math.cos(x * 4 - z * 2 + 1.1), 0, 1),
    1.45,
  );
  const highlandH = valleyWall * (6.5 + ridgeDetail * 9.5);

  let y = 2.4 + (h1 + h2) * 0.48 + h3 * 0.42 + highlandH;
  y = Math.max(0.85, y);

  // Havaalanı platosu (AIRFIELD_X = -68, AIRFIELD_Z = -42 çevresinde düz tesviye edilmiş 3B plato)
  const dax = Math.abs(wrapWorldDelta(wx - AIRFIELD_X));
  const daz = Math.abs(wrapWorldDelta(wz - AIRFIELD_Z));
  const airBox = Math.hypot(Math.max(0, dax - 24), Math.max(0, daz - 70));
  const airBlend = 1.0 - smoothstep(0.0, 32.0, airBox);
  y = y * (1 - airBlend) + AIRFIELD_Y * airBlend;

  // 3B Nehir Yatağı ve Göl Havzası Oyulması (su seviyesi WATER_Y = 0.0 altında gerçek 3B yatak!)
  const { dist: signedWaterDist } = getRiverHalfWidth(wx, wz);
  if (signedWaterDist < 26.0) {
    const bankT = smoothstep(-14.0, 24.0, signedWaterDist);
    const bedDepth = -2.4 - Math.sin(x * 5 + z * 5) * 0.35;
    y = bedDepth * (1 - bankT) + y * bankT;
  }

  // Köprü yaklaşım rampaları: nehir kıyısında yolun köprü tabliyesine (y = 1.55) pürüzsüz bağlanması
  const dbx = Math.abs(wrapWorldDelta(wx - BRIDGE_X));
  const dbz = Math.abs(wrapWorldDelta(wz - BRIDGE_Z));
  if (dbx > 13.0 && dbx < 42.0 && dbz < 7.5 && signedWaterDist > -0.5) {
    const rampX = smoothstep(13.0, 15.5, dbx) * (1.0 - smoothstep(24.0, 42.0, dbx));
    const rampZ = 1.0 - smoothstep(3.0, 7.2, dbz);
    const rampBlend = rampX * rampZ;
    y = y * (1 - rampBlend) + 1.55 * rampBlend;
  }

  return y;
}

/** Herhangi bir (wx, wz) noktasında 3B arazi normalini hesaplar. */
function sampleTerrainNormal(wx: number, wz: number, eps = 1.2): THREE.Vector3 {
  const hL = sampleWorldTerrain(wx - eps, wz);
  const hR = sampleWorldTerrain(wx + eps, wz);
  const hD = sampleWorldTerrain(wx, wz - eps);
  const hU = sampleWorldTerrain(wx, wz + eps);
  return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
}

/**
 * Rayleigh + Mie atmosferik saçılma, güneş halesi (solar aureole) ve yüksek irtifa
 * sirüs (cirrus) bulut tülünü tek geçişte hesaplayan aydınlık anime/Zelda gökyüzü shader'ı.
 */
function skyMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      midSky: { value: new THREE.Color(SKY_MID) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      groundCol: { value: new THREE.Color(0x689e52) },
      sunDir: { value: sunDir.clone().normalize() },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 zenith;
      uniform vec3 midSky;
      uniform vec3 horizon;
      uniform vec3 groundCol;
      uniform vec3 sunDir;
      uniform float uTime;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash2(i);
        float b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0));
        float d = hash2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        v += 0.50 * noise2(p); p = p * 2.03 + vec2(1.7, 9.2);
        v += 0.28 * noise2(p); p = p * 2.07 + vec2(8.3, 2.8);
        v += 0.14 * noise2(p);
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);

        vec3 col;
        if (h >= 0.0) {
          float tMid = clamp(pow(h, 0.42), 0.0, 1.0);
          float tZen = clamp(pow(max(h - 0.12, 0.0) / 0.88, 0.78), 0.0, 1.0);
          col = mix(horizon, midSky, tMid);
          col = mix(col, zenith, tZen);
        } else {
          col = mix(horizon, groundCol, clamp(-h * 4.0, 0.0, 1.0));
        }

        float mu = clamp(dot(d, sunDir), 0.0, 1.0);
        vec3 warmGlow = vec3(1.0, 0.96, 0.84);
        col += warmGlow * pow(mu, 4.5) * 0.22 * clamp(1.0 - abs(h) * 0.80, 0.0, 1.0);
        col += vec3(1.0, 0.98, 0.90) * pow(mu, 38.0) * 0.50;
        float sunDisc = smoothstep(0.9988, 0.9995, mu);
        col = mix(col, vec3(1.0, 1.0, 0.95), sunDisc);

        if (h > 0.04) {
          vec2 uv = d.xz / (h + 0.20) * 1.5 + vec2(uTime * 0.004, -uTime * 0.002);
          float n1 = fbm(uv * vec2(1.4, 0.65));
          float n2 = fbm(uv * vec2(2.6, 1.1) + vec2(n1 * 1.5, 3.1));
          float cirrus = smoothstep(0.48, 0.76, n2) * smoothstep(0.04, 0.24, h) * (1.0 - smoothstep(0.68, 0.98, h));
          col = mix(col, vec3(0.99, 1.0, 1.0), cirrus * 0.42);
        }

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/**
 * Kareli dokuyu tamamen ortadan kaldıran Gerçek 3B Arazi Mesh Üreticisi (240x240 = 115.200 üçgen).
 * SCENERY_SIZE periyodik olduğu için komşu dilimler arasında sıfır dikişle sonsuz 3B arazi oluşturur.
 */
function buildSculptedTerrainGeo(): THREE.BufferGeometry {
  const segs = 240;
  const geo = new THREE.PlaneGeometry(SCENERY_SIZE, SCENERY_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const normals = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const wy = sampleWorldTerrain(wx, wz);
    pos.setY(i, wy);
    const n = sampleTerrainNormal(wx, wz, 1.8);
    normals[i * 3] = n.x;
    normals[i * 3 + 1] = n.y;
    normals[i * 3 + 2] = n.z;
  }
  pos.needsUpdate = true;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/**
 * Canlı, huzur veren Ghibli / Zelda kırsalı tarzında 3B Arazi Shader'ı:
 * Güneşli zümrüt/bahar yeşili çayırlar, kır çiçekleri (pembe, sarı, beyaz),
 * nehir kıyısı sıcak çakılları ve köprüyle %100 hizalı kıvrımlı kır yolları.
 */
function createTerrainMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() },
      fogColor: { value: new THREE.Color(SKY_HORIZON) },
      fogDensity: { value: 0.00048 },
      kWorld: { value: K_WORLD },
      bridgeX: { value: BRIDGE_X },
      bridgeZ: { value: BRIDGE_Z },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vCamDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp;
        vCamDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vCamDist;
      uniform vec3 sunDir;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform float kWorld;
      uniform float bridgeX;
      uniform float bridgeZ;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash2(i);
        float b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0));
        float d = hash2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
        v += 0.50 * noise2(p); p = rot * p * 2.03 + vec2(3.1, 7.4);
        v += 0.25 * noise2(p); p = rot * p * 2.05 + vec2(8.7, 1.9);
        v += 0.15 * noise2(p); p = rot * p * 2.02 + vec2(2.3, 5.1);
        v += 0.10 * noise2(p);
        return v;
      }

      float wrapDelta(float d) {
        return d - floor(d / 1200.0 + 0.5) * 1200.0;
      }

      void main() {
        vec2 xz = vWorldPos.xz;
        float h = vWorldPos.y;

        // Çok ölçekli organik biyom gürültüsü (döndürülmüş oktavlar -> sıfır karelenme)
        float nMacro = fbm(xz * 0.011);
        float nMid = fbm(xz * 0.055 + vec2(nMacro * 1.9));
        float nMicro = fbm(xz * 0.38);
        float nBlade = noise2(xz * 2.1);

        // Canlı, ferah ve aydınlık Ghibli / Zelda bahar çayırı renk paleti
        vec3 colEmeraldGrass = vec3(0.26, 0.54, 0.22);
        vec3 colSunlitMeadow = vec3(0.40, 0.65, 0.25);
        vec3 colCloverShade  = vec3(0.18, 0.44, 0.19);
        vec3 colGoldenHill   = vec3(0.48, 0.68, 0.28);

        vec3 landCol = mix(colEmeraldGrass, colSunlitMeadow, smoothstep(0.24, 0.76, nMacro));
        landCol = mix(landCol, colCloverShade, smoothstep(0.48, 0.82, nMid) * 0.55);
        landCol = mix(landCol, colGoldenHill, smoothstep(0.56, 0.84, nMicro) * 0.42);

        // Renkli kır çiçeği tarlaları (sarı düğünçiçeği ve pembe kozmos benekleri)
        float yellowPatch = smoothstep(0.72, 0.89, nMid * nBlade);
        float pinkPatch = smoothstep(0.75, 0.91, (1.0 - nMacro) * nMicro);
        landCol = mix(landCol, vec3(0.90, 0.78, 0.24), yellowPatch * 0.25);
        landCol = mix(landCol, vec3(0.88, 0.52, 0.66), pinkPatch * 0.19);
        landCol *= 0.92 + 0.16 * (0.6 * nMicro + 0.4 * nBlade);

        // Nehir ve göl kıyısı: doğal sıcak çakıl ve aydınlık kumsal geçişi
        vec3 colWarmSand = vec3(0.72, 0.66, 0.52);
        vec3 colPebbles = vec3(0.78, 0.73, 0.60) * (0.90 + 0.16 * nBlade);
        float shoreFactor = 1.0 - smoothstep(-0.05, 0.58, h);
        vec3 shoreCol = mix(colPebbles, colWarmSand, 1.0 - smoothstep(-0.15, 0.18, h));
        landCol = mix(landCol, shoreCol, shoreFactor * 0.82);

        // Sarp yamaçlarda sıcak kireçtaşı/granit kaya dokusu
        float slope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
        float rockMask = smoothstep(0.26, 0.45, slope + (nMid - 0.5) * 0.08) * smoothstep(7.5, 15.0, h);
        vec3 colRock = mix(vec3(0.48, 0.52, 0.56), vec3(0.62, 0.65, 0.68), nMicro);
        landCol = mix(landCol, colRock, rockMask);

        // Kıvrımlı kırsal yollar (tam köprü tabliyesi hizasında 3B taş köprüye bağlanır)
        float inBridgeSpan = step(abs(wrapDelta(xz.x - bridgeX)), 13.4) * step(abs(wrapDelta(xz.y - bridgeZ)), 10.0);
        if (h > 0.12 && inBridgeSpan < 0.5) {
          float r1x = -136.0 + sin(xz.y * kWorld + 0.4) * 34.0 + cos(xz.y * 2.0 * kWorld - 0.7) * 14.0;
          float u2 = (xz.x - bridgeX) * kWorld;
          float r2z = bridgeZ + (sin(u2) - 0.5 * sin(2.0 * u2)) * 34.0;
          float d1 = abs(wrapDelta(xz.x - r1x));
          float d2 = abs(wrapDelta(xz.y - r2z));
          float dRoad = min(d1, d2);
          float along = d1 < d2 ? xz.y : xz.x;

          if (dRoad < 4.1) {
            vec3 gravelCol = vec3(0.62, 0.58, 0.50) * (0.92 + 0.14 * nBlade);
            float shoulderT = 1.0 - smoothstep(3.0, 4.1, dRoad);
            landCol = mix(landCol, gravelCol, shoulderT);
            if (dRoad < 3.05) {
              vec3 asphaltCol = vec3(0.24, 0.27, 0.31) * (0.94 + 0.12 * nBlade);
              float edgeLine = smoothstep(2.50, 2.62, dRoad) * (1.0 - smoothstep(2.74, 2.86, dRoad));
              asphaltCol = mix(asphaltCol, vec3(0.90, 0.93, 0.96), edgeLine * 0.82);
              float dash = step(0.45, fract(along * 0.12));
              float centerLine = (1.0 - smoothstep(0.08, 0.22, dRoad)) * dash;
              asphaltCol = mix(asphaltCol, vec3(0.92, 0.78, 0.24), centerLine * 0.88);
              landCol = mix(landCol, asphaltCol, 1.0 - smoothstep(2.80, 3.05, dRoad));
            }
          }
        }

        // Aydınlık, sıcak ve ferah doğal güneş ve gökyüzü aydınlatması
        vec3 microN = normalize(vNormal + vec3((nMicro - 0.5) * 0.14, 0.0, (nBlade - 0.5) * 0.14));
        float ndl = max(dot(microN, sunDir), 0.0);
        float hemi = 0.5 + 0.5 * microN.y;
        vec3 skyAmb = mix(vec3(0.40, 0.52, 0.42), vec3(0.72, 0.84, 0.94), hemi);
        vec3 sunLight = vec3(1.04, 1.00, 0.90) * (0.28 + 0.74 * ndl);
        vec3 lit = landCol * (skyAmb * 0.58 + sunLight * 0.78);
        lit = lit / (1.0 + 0.05 * lit);

        // Yumuşak atmosferik ufuk sisi
        float fogFactor = 1.0 - exp(- (fogDensity * vCamDist) * (fogDensity * vCamDist));
        lit = mix(lit, fogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(lit, 1.0);
      }`,
  });
}

/**
 * 3B Oyulmuş Nehir Yatağı ve Göl Havzası içinde akan gerçek 3B Su Yüzeyi Mesh Üreticisi.
 */
function buildWaterMeshGeo(): THREE.BufferGeometry {
  const segs = 220;
  const geo = new THREE.PlaneGeometry(SCENERY_SIZE, SCENERY_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const depths = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const ty = sampleWorldTerrain(wx, wz);
    const depth = WATER_Y - ty;
    depths[i] = depth;
    pos.setY(i, depth > -0.35 ? WATER_Y : ty - 1.2);
  }
  pos.needsUpdate = true;
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  return geo;
}

/**
 * Kare/ızgara deseni içermeyen, domain-warped FBM su dalgaları, güneş kostikleri (caustics),
 * berrak turkuaz-akuamarin kıyı geçişi ve su köpüğü içeren Ghibli/Zelda tarzı 3B Su Shader'ı.
 */
function createWaterMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() },
      uTime: { value: 0 },
      fogColor: { value: new THREE.Color(SKY_HORIZON) },
      fogDensity: { value: 0.00048 },
    },
    vertexShader: `
      attribute float aDepth;
      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vCamDist;
      void main() {
        vDepth = aDepth;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vCamDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vCamDist;
      uniform vec3 sunDir;
      uniform float uTime;
      uniform vec3 fogColor;
      uniform float fogDensity;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash2(i);
        float b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0));
        float d = hash2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      // Döndürülmüş oktavlı organik FBM (asla kare veya ızgara deseni oluşturmaz!)
      float fbmWater(vec2 p) {
        float v = 0.0;
        mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
        v += 0.52 * noise2(p); p = rot * p * 2.07 + vec2(4.2, 1.8);
        v += 0.30 * noise2(p); p = rot * p * 2.11 + vec2(1.5, 6.3);
        v += 0.18 * noise2(p);
        return v;
      }

      void main() {
        if (vDepth <= 0.0) discard;

        vec2 p = vWorldPos.xz;
        vec2 flow1 = p * 0.16 + vec2(uTime * 0.28, -uTime * 0.22);
        vec2 flow2 = p * 0.29 + vec2(-uTime * 0.19, -uTime * 0.31) + vec2(3.7, 8.1);

        float n1 = fbmWater(flow1);
        float n2 = fbmWater(flow2 + vec2(n1 * 1.1, -n1 * 0.9));
        float n3 = fbmWater(p * 0.55 + vec2(n2 * 1.4, uTime * 0.35));

        // Organik su yüzeyi normali (fark türevleri ile pürüzsüz dalgalanma)
        float nx = (n2 - 0.5) * 0.11 + (n3 - 0.5) * 0.06;
        float nz = (n1 - 0.5) * 0.11 - (n3 - 0.5) * 0.06;
        vec3 n = normalize(vec3(nx, 1.0, nz));

        // Berrak Ghibli / Zelda su renk paleti: sığ akuamarin -> canlı turkuaz -> huzurlu gök mavisi
        vec3 colCrystalShore = vec3(0.36, 0.86, 0.80);
        vec3 colTurquoiseMid = vec3(0.15, 0.68, 0.83);
        vec3 colSereneDeep   = vec3(0.09, 0.46, 0.74);

        vec3 waterCol = mix(colCrystalShore, colTurquoiseMid, smoothstep(0.05, 0.75, vDepth));
        waterCol = mix(waterCol, colSereneDeep, smoothstep(0.65, 2.0, vDepth));

        // Sığ ve orta derinlikte güneş ışığı su altı kostik (caustics) ışıltıları
        float causticRibbon = smoothstep(0.58, 0.76, n3) * (1.0 - smoothstep(0.3, 1.8, vDepth));
        waterCol += vec3(0.24, 0.38, 0.36) * causticRibbon * 0.55;

        // Gökyüzü Fresnel yansıması + Güneş parıltısı (sparkle)
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 2.8);
        waterCol = mix(waterCol, vec3(0.74, 0.90, 1.0), clamp(fresnel * 0.62, 0.10, 0.64));

        vec3 halfVec = normalize(sunDir + viewDir);
        float spec = pow(max(dot(n, halfVec), 0.0), 72.0);
        float sparkle = smoothstep(0.68, 0.82, n3) * pow(max(dot(n, halfVec), 0.0), 24.0);
        waterCol += vec3(1.0, 0.98, 0.90) * (spec * 0.85 + sparkle * 0.42);

        // Organik kıyı köpüğü (shoreline foam) ve su şeritleri
        float shoreBand = 1.0 - smoothstep(0.02, 0.28, vDepth + (n2 - 0.5) * 0.08);
        float innerRipple = smoothstep(0.66, 0.78, n2) * (1.0 - smoothstep(0.15, 0.55, vDepth));
        float foam = clamp(shoreBand * 0.82 + innerRipple * 0.45, 0.0, 1.0);
        waterCol = mix(waterCol, vec3(0.95, 0.99, 1.0), foam);

        float alpha = smoothstep(0.0, 0.10, vDepth) * 0.95;
        float fogFactor = 1.0 - exp(- (fogDensity * vCamDist) * (fogDensity * vCamDist));
        waterCol = mix(waterCol, fogColor, clamp(fogFactor, 0.0, 1.0));

        gl_FragColor = vec4(waterCol, alpha);
      }`,
  });
}

/**
 * Birden fazla geometri parçasını dikey (Y) renk gradyanıyla tek bir vertex-colored
 * BufferGeometry içinde birleştirir.
 */
function mergeColoredGeos(
  parts: { geo: THREE.BufferGeometry; colBot: number; colTop: number }[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const cB = new THREE.Color();
  const cT = new THREE.Color();
  const cCur = new THREE.Color();

  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    cB.setHex(part.colBot);
    cT.setHex(part.colTop);
    const span = Math.max(1e-4, yMax - yMin);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = clamp((y - yMin) / span, 0, 1);
      cCur.copy(cB).lerp(cT, t);
      positions.push(pos.getX(i), y, pos.getZ(i));
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      colors.push(cCur.r, cCur.g, cCur.b);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return out;
}

/** Gövdeli ve 4 katmanlı doğal zümrüt/ladin çam ağacı geometrisi. */
function buildPineTreeGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.14, 0.28, 1.5, 7);
  trunk.translate(0, 0.75, 0);
  const tier1 = new THREE.ConeGeometry(1.65, 2.0, 9);
  tier1.translate(0, 1.85, 0);
  const tier2 = new THREE.ConeGeometry(1.35, 1.85, 9);
  tier2.translate(0, 2.8, 0);
  const tier3 = new THREE.ConeGeometry(1.02, 1.65, 9);
  tier3.translate(0, 3.7, 0);
  const tier4 = new THREE.ConeGeometry(0.65, 1.4, 9);
  tier4.translate(0, 4.5, 0);
  return mergeColoredGeos([
    { geo: trunk, colBot: 0x482f1b, colTop: 0x704c2e },
    { geo: tier1, colBot: 0x1a451e, colTop: 0x337430 },
    { geo: tier2, colBot: 0x1f4f24, colTop: 0x3d853b },
    { geo: tier3, colBot: 0x255b29, colTop: 0x479442 },
    { geo: tier4, colBot: 0x2c672e, colTop: 0x54a54c },
  ]);
}

/** Dallı gövdeli ve 6 kubbeli doğal Ghibli/Zelda tarzı meşe/çınar ağacı geometrisi. */
function buildLeafTreeGeo(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 1.75, 7);
  trunk.translate(0, 0.87, 0);
  const b1 = new THREE.CylinderGeometry(0.08, 0.14, 1.1, 6);
  b1.rotateZ(0.55);
  b1.translate(-0.35, 1.75, 0.1);
  const b2 = new THREE.CylinderGeometry(0.08, 0.14, 1.1, 6);
  b2.rotateZ(-0.5);
  b2.translate(0.35, 1.8, -0.1);
  const mainCrown = new THREE.IcosahedronGeometry(1.5, 1);
  mainCrown.scale(1.1, 1.1, 1.1);
  mainCrown.translate(0, 3.1, 0);
  const sub1 = new THREE.IcosahedronGeometry(1.15, 1);
  sub1.translate(0.85, 2.55, 0.45);
  const sub2 = new THREE.IcosahedronGeometry(1.1, 1);
  sub2.translate(-0.8, 2.6, -0.4);
  const sub3 = new THREE.IcosahedronGeometry(1.05, 1);
  sub3.translate(-0.3, 2.65, 0.85);
  const sub4 = new THREE.IcosahedronGeometry(1.0, 1);
  sub4.translate(0.35, 2.7, -0.8);
  const topCrown = new THREE.IcosahedronGeometry(1.05, 1);
  topCrown.translate(0.05, 3.9, -0.15);
  return mergeColoredGeos([
    { geo: trunk, colBot: 0x48301d, colTop: 0x704f34 },
    { geo: b1, colBot: 0x503520, colTop: 0x704f34 },
    { geo: b2, colBot: 0x503520, colTop: 0x704f34 },
    { geo: mainCrown, colBot: 0x275a22, colTop: 0x5ba23b },
    { geo: sub1, colBot: 0x22511d, colTop: 0x529734 },
    { geo: sub2, colBot: 0x255520, colTop: 0x589d38 },
    { geo: sub3, colBot: 0x275921, colTop: 0x5ea43c },
    { geo: sub4, colBot: 0x22511d, colTop: 0x529734 },
    { geo: topCrown, colBot: 0x347029, colTop: 0x74bd48 },
  ]);
}

/** 3B Doğal Çalı / Fundalık Kümesi Geometrisi. */
function buildBushGeo(): THREE.BufferGeometry {
  const c0 = new THREE.IcosahedronGeometry(0.62, 1);
  c0.scale(1.2, 0.82, 1.15);
  c0.translate(0, 0.42, 0);
  const c1 = new THREE.IcosahedronGeometry(0.48, 1);
  c1.scale(1.1, 0.78, 1.1);
  c1.translate(0.42, 0.34, 0.24);
  const c2 = new THREE.IcosahedronGeometry(0.45, 1);
  c2.scale(1.1, 0.75, 1.05);
  c2.translate(-0.38, 0.32, -0.22);
  const c3 = new THREE.IcosahedronGeometry(0.4, 1);
  c3.translate(0.08, 0.56, -0.28);
  return mergeColoredGeos([
    { geo: c0, colBot: 0x214b1a, colTop: 0x539637 },
    { geo: c1, colBot: 0x1d4418, colTop: 0x4c8c32 },
    { geo: c2, colBot: 0x234d1c, colTop: 0x5a9f3b },
    { geo: c3, colBot: 0x2c6023, colTop: 0x6bb047 },
  ]);
}

/** 3B Doğal Ot / Çimen / Kır Çiçeği / Sazlık Demeti Geometrisi. */
function buildGrassTuftGeo(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; colBot: number; colTop: number }[] = [];
  const bladeCount = 12;
  for (let i = 0; i < bladeCount; i++) {
    const ring = i < 4 ? 0.06 : 0.16;
    const ang = (i / bladeCount) * Math.PI * 2 + (i % 3) * 0.22;
    const tilt = i < 4 ? 0.18 : 0.36 + (i % 3) * 0.14;
    const h = 0.52 + (i % 4) * 0.14;
    const blade = new THREE.ConeGeometry(0.11, h, 3);
    blade.scale(1.0, 1.0, 0.26);
    blade.translate(0, h * 0.48, 0);
    blade.rotateX(tilt);
    blade.rotateY(ang);
    blade.translate(Math.cos(ang) * ring, 0, Math.sin(ang) * ring);
    parts.push({
      geo: blade,
      colBot: 0x224f1c,
      colTop: i % 4 === 0 ? 0x86c442 : i % 2 === 0 ? 0x69a93c : 0x559632,
    });
  }
  return mergeColoredGeos(parts);
}

/** 3B Kaya ve Nehir Taşı Kümesi Geometrisi. */
function buildRockGeo(): THREE.BufferGeometry {
  const r1 = new THREE.DodecahedronGeometry(0.65, 0);
  r1.scale(1.25, 0.72, 1.05);
  r1.translate(0, 0.35, 0);
  const r2 = new THREE.DodecahedronGeometry(0.44, 0);
  r2.scale(1.15, 0.68, 0.95);
  r2.rotateY(0.9);
  r2.translate(0.52, 0.24, 0.26);
  const r3 = new THREE.DodecahedronGeometry(0.36, 0);
  r3.scale(1.0, 0.75, 1.1);
  r3.translate(-0.44, 0.2, -0.24);
  return mergeColoredGeos([
    { geo: r1, colBot: 0x555c63, colTop: 0x8f979e },
    { geo: r2, colBot: 0x4d545c, colTop: 0x828a92 },
    { geo: r3, colBot: 0x505954, colTop: 0x7d8c7b },
  ]);
}

/** Verandalı, taş subasmanlı, ahşap hatıllı, kiremit çatılı ve bacalı detaylı dağ/köy evi. */
function buildCountryHouseGeo(): THREE.BufferGeometry {
  const plinth = new THREE.BoxGeometry(3.1, 0.45, 2.5);
  plinth.translate(0, 0.225, 0);
  const wall = new THREE.BoxGeometry(2.8, 1.75, 2.2);
  wall.translate(0, 1.25, 0);
  const porchFloor = new THREE.BoxGeometry(2.9, 0.18, 0.75);
  porchFloor.translate(0, 0.42, 1.35);
  const roof = new THREE.ConeGeometry(2.45, 1.3, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.05, 1.0, 0.88);
  roof.translate(0, 2.72, 0.08);
  const chimney = new THREE.BoxGeometry(0.36, 1.1, 0.36);
  chimney.translate(0.75, 2.85, -0.4);
  const door = new THREE.BoxGeometry(0.46, 1.05, 2.26);
  door.translate(0, 0.98, 0);
  const winL = new THREE.BoxGeometry(0.5, 0.48, 2.26);
  winL.translate(-0.8, 1.35, 0);
  const winR = new THREE.BoxGeometry(0.5, 0.48, 2.26);
  winR.translate(0.8, 1.35, 0);
  const sideWin = new THREE.BoxGeometry(2.86, 0.48, 0.52);
  sideWin.translate(0, 1.35, 0);
  return mergeColoredGeos([
    { geo: plinth, colBot: 0x6b665e, colTop: 0x8a847a },
    { geo: porchFloor, colBot: 0x735035, colTop: 0x8f6645 },
    { geo: wall, colBot: 0xebe3d5, colTop: 0xfcf7ee },
    { geo: roof, colBot: 0x943d27, colTop: 0xc4563a },
    { geo: chimney, colBot: 0x783624, colTop: 0x9c4b35 },
    { geo: door, colBot: 0x452b19, colTop: 0x634128 },
    { geo: winL, colBot: 0x24425c, colTop: 0x46769e },
    { geo: winR, colBot: 0x24425c, colTop: 0x46769e },
    { geo: sideWin, colBot: 0x24425c, colTop: 0x46769e },
  ]);
}

/**
 * Ufuk çizgisini 360° çevreleyen, keskin sırtlı (ridged multifractal), yüksek çözünürlüklü
 * ve analitik türev normalli 3B Alp Sıradağları Geometrisi (poligonal dikey çizgi/kat izi bırakmaz!).
 */
function buildMountainRingGeo(
  rInner: number,
  rPeak: number,
  rOuter: number,
  maxPeakH: number,
  _snowLine: number,
  seedOffset = 0,
): THREE.BufferGeometry {
  const segs = 520;
  const rings = 16;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const evalPos = (ang: number, tRad: number, outV: THREE.Vector3) => {
    const a = ang + seedOffset;
    const envelope = Math.sin(tRad * Math.PI);
    const rBase =
      tRad < 0.46
        ? rInner + (rPeak - rInner) * (tRad / 0.46)
        : rPeak + (rOuter - rPeak) * ((tRad - 0.46) / 0.54);
    const rSpur =
      (Math.sin(a * 9 + tRad * 3.5) * 18 + Math.cos(a * 17 - tRad * 4.2) * 11) * envelope;
    const r = rBase + rSpur;

    let h = -3.0;
    if (envelope > 0.001) {
      // Ridged multifractal zirveler ve keskin dağ sırtları (yuvarlak hamur tepe yerine gerçek dağ silüeti)
      const r1 = 1.0 - Math.abs(Math.sin(a * 3.0 + 0.4));
      const r2 = 1.0 - Math.abs(Math.cos(a * 5.0 - 0.9 + Math.sin(a * 2.0) * 0.4));
      const r3 = 1.0 - Math.abs(Math.sin(a * 11.0 + tRad * 2.6 + 1.2));
      const r4 = 1.0 - Math.abs(Math.cos(a * 19.0 - tRad * 3.8 - 0.7));
      const r5 = 1.0 - Math.abs(Math.sin(a * 31.0 + tRad * 5.0 + seedOffset));

      const macroMod = 0.56 + 0.44 * Math.sin(a * 2.0 - 0.5) * Math.cos(a * 3.0 + 0.8);
      const ridgeProfile =
        Math.pow(r1, 1.35) * 0.38 +
        Math.pow(r2, 1.45) * 0.30 +
        Math.pow(r3, 1.55) * 0.18 +
        Math.pow(r4, 1.65) * 0.09 +
        r5 * 0.05;

      // Yan sırtlar (spurs) ve vadi olukları (couloirs)
      const gully = 1.0 - 0.28 * Math.pow(Math.abs(Math.sin(a * 14.0 + tRad * 3.1)), 1.5) * (1.0 - envelope * 0.45);
      const radialShape = Math.pow(envelope, 0.78);
      h = -2.0 + maxPeakH * radialShape * (0.25 + 0.75 * macroMod) * ridgeProfile * gully * 1.65;
    }

    outV.set(Math.cos(ang) * r, h, Math.sin(ang) * r);
  };

  const pC = new THREE.Vector3();
  const pA1 = new THREE.Vector3();
  const pA2 = new THREE.Vector3();
  const pR1 = new THREE.Vector3();
  const pR2 = new THREE.Vector3();
  const tAng = new THREE.Vector3();
  const tRadV = new THREE.Vector3();
  const nV = new THREE.Vector3();

  const epsA = (Math.PI * 2) / (segs * 1.5);
  const epsR = 0.6 / rings;

  for (let i = 0; i <= segs; i++) {
    const ang = (i / segs) * Math.PI * 2;
    for (let j = 0; j <= rings; j++) {
      const tRad = j / rings;
      evalPos(ang, tRad, pC);
      positions.push(pC.x, pC.y, pC.z);

      evalPos(ang - epsA, tRad, pA1);
      evalPos(ang + epsA, tRad, pA2);
      tAng.subVectors(pA2, pA1);

      const rLo = Math.max(0.001, tRad - epsR);
      const rHi = Math.min(0.999, tRad + epsR);
      evalPos(ang, rLo, pR1);
      evalPos(ang, rHi, pR2);
      tRadV.subVectors(pR2, pR1);

      nV.crossVectors(tAng, tRadV).normalize();
      if (nV.y < 0) nV.negate();
      normals.push(nV.x, nV.y, nV.z);
    }
  }

  const stride = rings + 1;
  for (let i = 0; i < segs; i++) {
    const b0 = i * stride;
    const b1 = (i + 1) * stride;
    for (let j = 0; j < rings; j++) {
      indices.push(b0 + j, b1 + j + 1, b0 + j + 1, b0 + j, b1 + j, b1 + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Ghibli / Zelda tarzı piksel-bazlı 3B Dağ Shader'ı:
 * Ormanlık yeşil etekler, sarp granit/kireçtaşı kayalık sırtlar, yalnızca vadi olukları
 * ve yüksek zirvelerde tutunan kar örtüsü ve atmosferik mavi derinlik perspektifi.
 */
function createMountainMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      sunDir: { value: sunDir.clone().normalize() },
      skyHorizon: { value: new THREE.Color(SKY_HORIZON) },
      skyMid: { value: new THREE.Color(SKY_MID) },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      varying vec3 vNormal;
      varying float vCamDist;
      void main() {
        vLocalPos = position;
        vNormal = normalize(normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        vCamDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vLocalPos;
      varying vec3 vNormal;
      varying float vCamDist;
      uniform vec3 sunDir;
      uniform vec3 skyHorizon;
      uniform vec3 skyMid;

      float hash2(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash2(i);
        float b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0));
        float d = hash2(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbmMtn(vec2 p) {
        float v = 0.0;
        mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
        v += 0.50 * noise2(p); p = rot * p * 2.04 + vec2(2.4, 6.1);
        v += 0.28 * noise2(p); p = rot * p * 2.07 + vec2(7.3, 1.8);
        v += 0.14 * noise2(p); p = rot * p * 2.03 + vec2(4.1, 8.5);
        v += 0.08 * noise2(p);
        return v;
      }

      void main() {
        float h = vLocalPos.y;
        vec2 uv = vLocalPos.xz * 0.0085;
        float n1 = fbmMtn(uv);
        float n2 = fbmMtn(uv * 3.4 + vec2(n1 * 1.6, h * 0.015));
        float nCrag = fbmMtn(uv * 9.5 + vec2(0.0, h * 0.04));

        // Piksel bazlı kaya sırtı mikro-normali (poligonal köşeleri tamamen yok eder!)
        vec3 n = normalize(vNormal + vec3((n2 - 0.5) * 0.34, (nCrag - 0.5) * 0.14, (n1 - 0.5) * 0.34));
        float slope = 1.0 - clamp(n.y, 0.0, 1.0);

        // 1. Eteklerde doğal çam ormanı ve dağ çayırı
        vec3 colForest = vec3(0.18, 0.44, 0.20);
        vec3 colAlpineMeadow = vec3(0.32, 0.58, 0.25);
        vec3 baseGreen = mix(colForest, colAlpineMeadow, smoothstep(0.30, 0.72, n1));

        // 2. Sarp kayalık yüzeyler (güneşli granit + gölgeli arduvaz kaya)
        vec3 colRockLit = mix(vec3(0.48, 0.52, 0.58), vec3(0.62, 0.65, 0.70), nCrag);
        vec3 colRockShade = vec3(0.28, 0.38, 0.50);
        float rockTransition = smoothstep(20.0, 50.0, h + (n1 - 0.5) * 20.0 + slope * 38.0);
        vec3 mtnCol = mix(baseGreen, colRockLit, rockTransition);

        // 3. Zirve ve vadi oluklarında (couloir) aydınlık doğal kar örtüsü
        float snowScore = h + (n2 - 0.5) * 28.0 - slope * 54.0;
        float snowMask = smoothstep(54.0, 82.0, snowScore) * smoothstep(36.0, 56.0, h);
        vec3 colSnow = vec3(0.94, 0.96, 0.98);
        mtnCol = mix(mtnCol, colSnow, snowMask);

        // Aydınlık Güneş & Gökyüzü Işıklandırması
        float ndl = max(dot(n, sunDir), 0.0);
        vec3 shadowTint = mix(vec3(0.42, 0.54, 0.70), colRockShade, rockTransition * 0.55);
        vec3 sunTint = vec3(1.04, 1.00, 0.92);
        vec3 lit = mtnCol * mix(shadowTint * 0.85, sunTint * 1.06, smoothstep(0.06, 0.60, ndl));

        // Hafif atmosferik derinlik
        float haze = clamp(smoothstep(950.0, 1650.0, vCamDist) * 0.24, 0.0, 0.26);
        vec3 hazeCol = mix(skyHorizon, skyMid, clamp(h / 220.0, 0.0, 0.45));
        lit = mix(lit, hazeCol, haze);

        gl_FragColor = vec4(lit, 1.0);
      }`,
  });
}

/**
 * Sivri pruvalı (bow), dışa kavisli bordalı (freeboard), su kesimi şeritli (boot-stripe),
 * 3B küpeşte korkuluklu (gunwale rim) ve tik güverteli (teak deck) gerçek 3B Tekne Gövdesi Üreticisi.
 * Tüm üçgen sarım yönleri (winding order) dışa (+Normal) ve yukarı (+Y) bakacak şekilde üretilir.
 */
function buildBoatHullGeo(
  length: number,
  beam: number,
  freeboard: number,
  draft: number,
  colBottom: number,
  colFreeboard: number,
  colGunwale: number,
  colDeck: number,
  deckRecess = 0.03,
): THREE.BufferGeometry {
  const nZ = 18;
  const halfL = length * 0.5;
  const halfB = beam * 0.5;

  const lowerPos: number[] = [];
  const lowerIdx: number[] = [];
  const upperPos: number[] = [];
  const upperIdx: number[] = [];
  const gunwalePos: number[] = [];
  const gunwaleIdx: number[] = [];
  const deckPos: number[] = [];
  const deckIdx: number[] = [];

  // s = 0 (kıç / stern transom, z = -halfL) -> s = 1 (sivri pruva / bow tip, z = +halfL)
  for (let i = 0; i <= nZ; i++) {
    const s = i / nZ;
    const z = -halfL + s * length;

    // Gerçek yat/tekne su hattı planı: kıçta 0.65 genişlik, s=0.45'te maksimum 1.0, pruvada (s=1) 0.012 sivri burun
    const beamFactor =
      s < 0.45
        ? 0.65 + 0.35 * Math.sin((s / 0.45) * (Math.PI * 0.5))
        : Math.pow(Math.max(0.0, (1.0 - s) / 0.55), 0.78);
    const wGun = halfB * Math.max(0.015, beamFactor);
    const wChine = wGun * 0.80;
    const wInner = wGun * 0.84;

    // Pruva ve kıça doğru hafif yükselen zarif küpeşte eğrisi (sheer line)
    const sheerY = freeboard * (0.92 + 0.14 * (1 - s) * (1 - s) + 0.34 * s * s);
    const chineY = 0.06 + 0.05 * s * s;
    const keelY = -draft * (1.0 - 0.35 * s);
    const deckY = sheerY - deckRecess;

    // 1. Alt Gövde / Su Hattı Şeridi (Sol Sintine -> Omurga -> Sağ Sintine: 3 nokta)
    lowerPos.push(-wChine, chineY, z, 0, keelY, z, wChine, chineY, z);

    // 2. Üst Borda (Freeboard: Sol Küpeşte(0), Sol Sintine(1), Sağ Sintine(2), Sağ Küpeşte(3): 4 nokta)
    upperPos.push(-wGun, sheerY, z, -wChine, chineY, z, wChine, chineY, z, wGun, sheerY, z);

    // 3. Küpeşte Korkuluk Çıtası (Gunwale Rim: Sol Dış(0), Sol İç(1), Sağ İç(2), Sağ Dış(3): 4 nokta)
    gunwalePos.push(
      -wGun * 1.03,
      sheerY + 0.05,
      z,
      -wInner,
      sheerY + 0.05,
      z,
      wInner,
      sheerY + 0.05,
      z,
      wGun * 1.03,
      sheerY + 0.05,
      z,
    );

    // 4. İç Güverte / Taban (Sol(0), Orta(1), Sağ(2): 3 nokta, normal +Y YUKARI)
    deckPos.push(-wInner, deckY, z, 0, deckY + 0.02, z, wInner, deckY, z);
  }

  for (let i = 0; i < nZ; i++) {
    // Alt Gövde dışa bakan üçgenler (T_k x F = DIŞARI)
    const l0 = i * 3;
    const l1 = (i + 1) * 3;
    lowerIdx.push(l0, l0 + 1, l1 + 1, l0, l1 + 1, l1);
    lowerIdx.push(l0 + 1, l0 + 2, l1 + 2, l0 + 1, l1 + 2, l1 + 1);

    // Üst Borda dışa bakan üçgenler (Sol borda k=0->1 ve Sağ borda k=2->3)
    const u0 = i * 4;
    const u1 = (i + 1) * 4;
    upperIdx.push(u0, u0 + 1, u1 + 1, u0, u1 + 1, u1);
    upperIdx.push(u0 + 2, u0 + 3, u1 + 3, u0 + 2, u1 + 3, u1 + 2);

    // Küpeşte Çıtası üst yüzeyi (+Y YUKARI: (+Z) x (+X) = +Y)
    const g0 = i * 4;
    const g1 = (i + 1) * 4;
    gunwaleIdx.push(g0, g1, g0 + 1, g0 + 1, g1, g1 + 1);
    gunwaleIdx.push(g0 + 2, g1 + 2, g0 + 3, g0 + 3, g1 + 2, g1 + 3);

    // Güverte üst yüzeyi (+Y YUKARI: (+Z) x (+X) = +Y)
    const d0 = i * 3;
    const d1 = (i + 1) * 3;
    deckIdx.push(d0, d1, d0 + 1, d0 + 1, d1, d1 + 1);
    deckIdx.push(d0 + 1, d1 + 1, d0 + 2, d0 + 2, d1 + 1, d1 + 2);
  }

  // Kıç Aynası (Stern Transom Cap, i = 0, normal -Z ARKAYA)
  upperIdx.push(0, 3, 2, 0, 2, 1);
  lowerIdx.push(0, 2, 1);

  const makePart = (posArr: number[], idxArr: number[], colBot: number, colTop: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    g.setIndex(idxArr);
    return { geo: g, colBot, colTop };
  };

  return mergeColoredGeos([
    makePart(lowerPos, lowerIdx, colBottom, colBottom),
    makePart(upperPos, upperIdx, colFreeboard, colFreeboard),
    makePart(gunwalePos, gunwaleIdx, colGunwale, colGunwale),
    makePart(deckPos, deckIdx, colDeck, colDeck),
  ]);
}

/**
 * Tek yönlü (single-winding) pürüzsüz normalli 3B Kavisli Üçgen Yelken Geometrisi.
 * (Ön ve arka yüzeyin aynı köşeleri paylaşıp normal vektörlerini sıfırlaması hatasını tamamen önler!)
 */
function buildTriangularSailGeo(
  zFootFront: number,
  yFootFront: number,
  zFootBack: number,
  yFootBack: number,
  zHead: number,
  yHead: number,
  camber: number,
): THREE.BufferGeometry {
  const segU = 10;
  const segV = 12;
  const pos: number[] = [];
  const idx: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = (iv / segV) * 0.985; // Direk tepesinde dejenere üçgen oluşmaması için %98.5'e kadar daralır
    const zFront = zFootFront + (zHead - zFootFront) * v;
    const yFront = yFootFront + (yHead - yFootFront) * v;
    // Arka kenarda (leech) zarif dışbükey yelken kavisi (roach)
    const roach = Math.sin(v * Math.PI) * 0.14 * Math.sign(zFootBack - zFootFront);
    const zBack = zFootBack + (zHead - zFootBack) * v + roach;
    const yBack = yFootBack + (yHead - yFootBack) * v;

    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const z = zFront + (zBack - zFront) * u;
      const y = yFront + (yBack - yFront) * u;
      const x = Math.sin(u * Math.PI) * (1.0 - v * 0.45) * camber;
      pos.push(x, y, z);
    }
  }

  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    const r0 = iv * stride;
    const r1 = (iv + 1) * stride;
    for (let iu = 0; iu < segU; iu++) {
      idx.push(r0 + iu, r0 + iu + 1, r1 + iu + 1);
      idx.push(r0 + iu, r1 + iu + 1, r1 + iu);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tekne altında su yüzeyinde oluşan hafif V-şekilli beyaz köpük/iz (Wake) geometrisi. */
function buildBoatWakeMesh(length: number, beam: number): THREE.Mesh {
  const wakeMat = new THREE.MeshBasicMaterial({
    color: 0xe0f7fa,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const ring = new THREE.RingGeometry(beam * 0.42, beam * 0.65, 16);
  ring.rotateX(-Math.PI / 2);
  ring.scale(1.0, 1.0, length / beam);
  const m = new THREE.Mesh(ring, wakeMat);
  m.position.y = 0.02;
  return m;
}

/**
 * Gerçekçi 3B Yelkenli Yat (Sailing Yacht):
 * Sivri pruvalı beyaz/krem gövde, su kesimi şeridi, maun küpeşte çıtası, tik güverte,
 * eğimli ön camlı kamara, arka havuzluk (cockpit), direk, bumba, baş ıstralya (forestay)
 * ve pürüzsüz kavisli Ana Yelken + Ön Flok Yelkeni.
 */
function buildSailboatMesh(hullCol = 0xf4f6f9, stripeCol = 0x1d4ed8, sailCol = 0xfaf6ec): THREE.Group {
  const g = new THREE.Group();
  const vtxMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const hullMesh = new THREE.Mesh(
    buildBoatHullGeo(5.8, 1.82, 0.48, 0.35, stripeCol, hullCol, 0x8c4f27, 0xc48b52, 0.04),
    vtxMat,
  );
  hullMesh.castShadow = true;
  g.add(hullMesh, buildBoatWakeMesh(6.2, 2.0));

  // Aerodinamik Kamara (Coachroof Cabin) + eğimli lacivert ön ve yan camlar
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0xf1f5f9 });
  const winMat = new THREE.MeshLambertMaterial({ color: 0x173552 });
  const teakMat = new THREE.MeshLambertMaterial({ color: 0x8c5228 });

  const cabinBase = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.34, 1.65), cabinMat);
  cabinBase.position.set(0, 0.56, 0.25);
  const cabinFront = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.28, 0.55), winMat);
  cabinFront.rotation.x = 0.42;
  cabinFront.position.set(0, 0.54, 1.02);
  const cabinSideWin = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.14, 1.15), winMat);
  cabinSideWin.position.set(0, 0.58, 0.20);
  const cabinRoofTrim = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.06, 1.45), teakMat);
  cabinRoofTrim.position.set(0, 0.74, 0.22);

  // Arka Havuzluk (Cockpit) oturma bankları
  const benchL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 1.35), teakMat);
  benchL.position.set(-0.46, 0.48, -1.45);
  const benchR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 1.35), teakMat);
  benchR.position.set(0.46, 0.48, -1.45);
  g.add(cabinBase, cabinFront, cabinSideWin, cabinRoofTrim, benchL, benchR);

  // Alüminyum Direk (Mast), gurcata (spreader), ahşap bumba (Boom)
  const mastMat = new THREE.MeshLambertMaterial({ color: 0xdbe4ee });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.065, 5.8, 8), mastMat);
  mast.position.set(0, 3.3, 0.55);
  const spreader = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 6).rotateZ(Math.PI / 2), mastMat);
  spreader.position.set(0, 3.6, 0.55);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.55, 8).rotateX(Math.PI / 2), teakMat);
  boom.position.set(0.08, 0.96, -0.75);
  boom.rotation.y = 0.08;
  g.add(mast, spreader, boom);

  // Pürüzsüz Üçgen Ana Yelken (Mainsail) ve Pruvadan Direğe Uzanan Ön Flok Yelkeni (Forestay Jib)
  // castShadow=false & receiveShadow=false sayesinde ince çift taraflı yelkende asla gölge lekesi (shadow acne) oluşmaz!
  const sailMat = new THREE.MeshLambertMaterial({ color: sailCol, side: THREE.DoubleSide });
  const mainSail = new THREE.Mesh(
    buildTriangularSailGeo(0.50, 1.00, -1.98, 1.00, 0.50, 5.95, 0.28),
    sailMat,
  );
  mainSail.rotation.y = 0.08;
  mainSail.castShadow = false;
  mainSail.receiveShadow = false;

  // Ön flok yelkeni: tam sivri pruva ucundan (z = +2.78, y = 0.68) direk üst kısmına (z = +0.58, y = 5.15) uzanır!
  const jibSail = new THREE.Mesh(
    buildTriangularSailGeo(2.78, 0.68, 0.72, 0.86, 0.58, 5.15, 0.24),
    sailMat,
  );
  jibSail.rotation.y = 0.06;
  jibSail.castShadow = false;
  jibSail.receiveShadow = false;

  // Direk tepesi kırmızı rüzgâr flaması
  const flag = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.48, 4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe11d48 }),
  );
  flag.position.set(0, 6.22, 0.32);

  g.add(mainSail, jibSail, flag);
  return g;
}

/**
 * Gerçekçi 3B Ahşap Sandal / Balıkçı Kayığı (Rowboat):
 * Çukur iç tabanlı ahşap borda, pruva üçgen kaplaması, 3 adet ahşap oturma tahtası ve iki yanında kürekler.
 */
function buildRowboatMesh(hullCol = 0x8f4f26): THREE.Group {
  const g = new THREE.Group();
  const vtxMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // deckRecess = 0.22 ile sandalın içi çukur kalır, kenar bordaları ve oturma tahtaları net görünür!
  const hull = new THREE.Mesh(
    buildBoatHullGeo(3.6, 1.34, 0.38, 0.22, 0x4a2511, hullCol, 0xd49a62, 0x5c3419, 0.22),
    vtxMat,
  );
  hull.castShadow = true;
  g.add(hull, buildBoatWakeMesh(3.8, 1.45));

  const seatMat = new THREE.MeshLambertMaterial({ color: 0xc88a52 });
  for (const [sz, sw] of [
    [-0.85, 0.88],
    [0.0, 1.04],
    [0.82, 0.74],
  ]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.06, 0.28), seatMat);
    bench.position.set(0, 0.31, sz);
    g.add(bench);
  }

  // İki yanda ıskarmozlara oturan ahşap kürekler (Oars)
  const oarMat = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  for (const side of [-1, 1]) {
    const oarGroup = new THREE.Group();
    oarGroup.position.set(side * 0.58, 0.42, 0.05);
    oarGroup.rotation.z = -side * 0.26;
    oarGroup.rotation.y = side * 0.18;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.85, 6).rotateZ(Math.PI / 2), oarMat);
    shaft.position.x = side * 0.48;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.025, 0.16), oarMat);
    blade.position.x = side * 1.25;
    oarGroup.add(shaft, blade);
    g.add(oarGroup);
  }
  return g;
}

/**
 * Klasik Riva / Cruiser Tarzı 3B Gezi Motoru (Motor Launch):
 * Parlak maun/lacivert gövde, eğimli panoramik ön cam, krem deri koltuklar, güneşlik tente (bimini) ve kıç motoru.
 */
function buildMotorLaunchMesh(hullCol = 0x164e63): THREE.Group {
  const g = new THREE.Group();
  const vtxMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const hull = new THREE.Mesh(
    buildBoatHullGeo(5.0, 1.68, 0.44, 0.28, hullCol, 0xf1f5f9, 0x8f4923, 0x9c5227, 0.06),
    vtxMat,
  );
  hull.castShadow = true;
  g.add(hull, buildBoatWakeMesh(5.5, 1.85));

  // Eğimli panoramik ön cam + krom çerçeve
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.16, 0.34, 0.55),
    new THREE.MeshLambertMaterial({ color: 0x1e3a5f }),
  );
  glass.rotation.x = 0.48;
  glass.position.set(0, 0.54, 0.58);

  // Krem deri ön koltuklar + arka U-oturma grubu ve güneşlenme minderi
  const seatMat = new THREE.MeshLambertMaterial({ color: 0xf5ebd6 });
  const frontSeats = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.24, 0.48), seatMat);
  frontSeats.position.set(0, 0.48, 0.05);
  const rearLounge = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.24, 1.05), seatMat);
  rearLounge.position.set(0, 0.48, -1.05);

  // Zarif güneşlik tente (Bimini Top) + krom dikmeler
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
  const strutMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1 });
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.06, 1.55), canopyMat);
  canopy.position.set(0, 1.18, -0.35);
  for (const sx of [-0.54, 0.54]) {
    for (const sz of [-0.95, 0.25]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 6), strutMat);
      strut.position.set(sx, 0.82, sz);
      g.add(strut);
    }
  }

  // Kıçtan takma motor (Outboard Engine)
  const motor = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.48, 0.36),
    new THREE.MeshLambertMaterial({ color: 0x1e293b }),
  );
  motor.position.set(0, 0.38, -2.55);

  g.add(glass, frontSeats, rearLounge, canopy, motor);
  return g;
}

/**
 * 3B Nehir Üzerinde Taş Kemerli & Fenerli Köprü (BRIDGE_X, BRIDGE_Z noktasında yolla %100 hizalı!).
 */
function buildScenicBridge(): THREE.Group {
  const bridge = new THREE.Group();
  bridge.position.set(BRIDGE_X, WATER_Y, BRIDGE_Z);

  const stoneMat = new THREE.MeshLambertMaterial({ color: 0xe6dec8 });
  const stoneTrimMat = new THREE.MeshLambertMaterial({ color: 0xc9bfa6 });
  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x343840 });
  const lineWhiteMat = new THREE.MeshBasicMaterial({ color: 0xf4f7fa });
  const lineYellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const lanternGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe58f });

  // 14 segmentli hafif kavisli (cambered) köprü tabliyesi + asfalt + kesintisiz yol çizgileri
  // x = -17.5 .. +17.5 boyunca kenarlarda y = 1.55 (arazi yolu seviyesi), ortada y = 2.05
  const nSeg = 14;
  const halfSpan = 17.5;
  for (let i = 0; i < nSeg; i++) {
    const t0 = i / nSeg;
    const t1 = (i + 1) / nSeg;
    const x0 = -halfSpan + t0 * halfSpan * 2;
    const x1 = -halfSpan + t1 * halfSpan * 2;
    const xm = (x0 + x1) * 0.5;
    const segLen = x1 - x0 + 0.08;
    const archCamber = Math.cos(((xm / halfSpan) * Math.PI) / 2);
    const ym = 1.52 + 0.52 * archCamber;
    const slopeAngle = (-0.52 * (Math.PI / (2 * halfSpan)) * Math.sin(((xm / halfSpan) * Math.PI) / 2));

    const segGroup = new THREE.Group();
    segGroup.position.set(xm, ym, 0);
    segGroup.rotation.z = slopeAngle;

    // Taş tabliye gövdesi
    const stoneDeck = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.42, 6.2), stoneMat);
    stoneDeck.castShadow = true;
    // Üst asfalt kaplama (arazi yolu genişliğiyle birebir: 5.1 birim)
    const roadSurface = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.08, 5.1), asphaltMat);
    roadSurface.position.y = 0.22;
    // Beyaz kenar çizgileri
    const edgeN = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.09, 0.18), lineWhiteMat);
    edgeN.position.set(0, 0.225, -2.25);
    const edgeS = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.09, 0.18), lineWhiteMat);
    edgeS.position.set(0, 0.225, 2.25);
    segGroup.add(stoneDeck, roadSurface, edgeN, edgeS);

    // Kesikli sarı orta çizgi
    if (i % 2 === 0) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(segLen * 0.65, 0.09, 0.18), lineYellowMat);
      dash.position.set(0, 0.225, 0);
      segGroup.add(dash);
    }

    // İki yanda taş korkuluk duvarları (parapet)
    for (const rz of [-2.82, 2.82]) {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.52, 0.36), stoneTrimMat);
      parapet.position.set(0, 0.45, rz);
      const coping = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.04, 0.12, 0.46), stoneMat);
      coping.position.set(0, 0.74, rz);
      segGroup.add(parapet, coping);
    }

    bridge.add(segGroup);
  }

  // Nehir içinde 4 adet taş kemer ayağı (Piers with cutwaters) + 3 adet yarım daire taş kemer + sokak fenerleri
  const pierXs = [-12.0, -4.0, 4.0, 12.0];
  for (const px of pierXs) {
    const archCamber = Math.cos(((px / halfSpan) * Math.PI) / 2);
    const deckY = 1.52 + 0.52 * archCamber;
    // Ana taş ayak (su tabanından tabliyeye kadar)
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, deckY + 1.8, 8), stoneTrimMat);
    pier.scale.set(0.85, 1.0, 2.75);
    pier.position.set(px, (deckY - 1.8) * 0.5, 0);
    pier.castShadow = true;
    bridge.add(pier);

    // Korkuluk üzerinde taş sütun + sıcak ışıklı köprü feneri
    for (const rz of [-2.82, 2.82]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.58), stoneMat);
      pillar.position.set(px, deckY + 0.55, rz);
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.95, 6),
        new THREE.MeshLambertMaterial({ color: 0x2c353d }),
      );
      post.position.set(px, deckY + 1.35, rz);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), lanternGlowMat);
      lantern.position.set(px, deckY + 1.88, rz);
      bridge.add(pillar, post, lantern);
    }
  }

  // Ayaklar arasında 3 adet taş kemer tonozu (Arch rings)
  for (const archX of [-8.0, 0.0, 8.0]) {
    const archRing = new THREE.Mesh(
      new THREE.CylinderGeometry(3.15, 3.15, 5.9, 18, 1, true, 0, Math.PI).rotateX(Math.PI / 2),
      stoneTrimMat,
    );
    archRing.scale.set(1.0, 0.46, 1.0);
    archRing.position.set(archX, 0.25, 0);
    bridge.add(archRing);
  }

  return bridge;
}

/** Güneşli tepe üzerinde yavaşça dönen 4 kanatlı kırsal Yel Değirmeni (Windmill). */
function buildWindmill(): { group: THREE.Group; blades: THREE.Group } {
  const group = new THREE.Group();
  const wx = -28;
  const wz = -112;
  const wy = sampleWorldTerrain(wx, wz);
  group.position.set(wx, wy - 0.15, wz);
  group.rotation.y = 0.35;

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.75, 1.6, 8),
    new THREE.MeshLambertMaterial({ color: 0x8a8275 }),
  );
  base.position.y = 0.8;
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.35, 4.2, 8),
    new THREE.MeshLambertMaterial({ color: 0xf7f2e6 }),
  );
  tower.position.y = 3.6;
  tower.castShadow = true;
  const dome = new THREE.Mesh(
    new THREE.ConeGeometry(1.12, 1.15, 8),
    new THREE.MeshLambertMaterial({ color: 0xa8442a }),
  );
  dome.position.y = 6.25;
  group.add(base, tower, dome);

  const blades = new THREE.Group();
  blades.position.set(0, 5.15, 1.12);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.45, 8).rotateX(Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x5c3a21 }),
  );
  blades.add(hub);

  const armMat = new THREE.MeshLambertMaterial({ color: 0x6e472b });
  const canvasMat = new THREE.MeshLambertMaterial({ color: 0xfffdf5, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const wing = new THREE.Group();
    wing.rotation.z = (i * Math.PI) / 2;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.1, 0.1), armMat);
    spar.position.y = 1.55;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.58, 2.5, 0.03), canvasMat);
    sail.position.set(0.32, 1.65, 0.02);
    sail.rotation.y = 0.18;
    wing.add(spar, sail);
    blades.add(wing);
  }
  group.add(blades);
  return { group, blades };
}

/**
 * 3B Havaalanı Platosu üzerinde Bölgesel Havaalanı, Yolla %100 Hizalı 3B Taş Kemer Köprü,
 * Göl Marinası, Balıkçı İskelesi, Kırsal Yel Değirmeni ve 12 adet Gerçek 3B Tekne / Yelkenli.
 */
function buildWorldLandmarks(): {
  group: THREE.Group;
  windsock: THREE.Group;
  beacon: THREE.Mesh;
  boats: THREE.Group[];
  windmillBlades: THREE.Group;
} {
  const group = new THREE.Group();
  const boats: THREE.Group[] = [];

  // ---- 1. Bölgesel Havaalanı (AIRFIELD_X = -68, AIRFIELD_Y = 1.85, AIRFIELD_Z = -42) ----
  const airport = new THREE.Group();
  airport.position.set(AIRFIELD_X, AIRFIELD_Y + 0.05, AIRFIELD_Z);

  const rwyC = document.createElement('canvas');
  rwyC.width = 256;
  rwyC.height = 1024;
  const rx = rwyC.getContext('2d')!;
  rx.fillStyle = '#2d3036';
  rx.fillRect(0, 0, 256, 1024);
  rx.fillStyle = '#f0f4f8';
  rx.fillRect(14, 20, 6, 984);
  rx.fillRect(236, 20, 6, 984);
  for (let k = 0; k < 6; k++) {
    const ox = 32 + k * 14;
    rx.fillRect(ox, 28, 8, 42);
    rx.fillRect(256 - ox - 8, 28, 8, 42);
    rx.fillRect(ox, 954, 8, 42);
    rx.fillRect(256 - ox - 8, 954, 8, 42);
  }
  rx.fillRect(46, 140, 22, 54);
  rx.fillRect(188, 140, 22, 54);
  rx.fillRect(46, 830, 22, 54);
  rx.fillRect(188, 830, 22, 54);
  for (let y = 95; y < 930; y += 44) {
    rx.fillRect(124, y, 8, 26);
  }
  const rwyTex = new THREE.CanvasTexture(rwyC);
  rwyTex.anisotropy = 8;
  rwyTex.colorSpace = THREE.SRGBColorSpace;

  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(11.5, 126).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: rwyTex }),
  );
  runway.receiveShadow = true;
  airport.add(runway);

  // PAPI yaklaşma ışıkları (2 beyaz, 2 kırmızı)
  for (let i = 0; i < 4; i++) {
    const papi = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: i < 2 ? 0xffffff : 0xff2828 }),
    );
    papi.position.set(7.2 + i * 0.9, 0.2, 42);
    airport.add(papi);
  }

  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x383c42 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(15, 38).rotateX(-Math.PI / 2), asphaltMat);
  apron.position.set(-14.5, -0.01, 0);
  apron.receiveShadow = true;
  const taxi1 = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 3.4).rotateX(-Math.PI / 2), asphaltMat);
  taxi1.position.set(-7.2, -0.01, -13);
  const taxi2 = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 3.4).rotateX(-Math.PI / 2), asphaltMat);
  taxi2.position.set(-7.2, -0.01, 13);
  airport.add(apron, taxi1, taxi2);

  // Kemerli uçak hangarları + Terminal binası
  const hangarWallMat = new THREE.MeshLambertMaterial({ color: 0xdfe5ec });
  const hangarRoofMat = new THREE.MeshLambertMaterial({ color: 0x264263 });
  const hangarDoorMat = new THREE.MeshLambertMaterial({ color: 0x1c2229 });
  for (const hz of [-11, 11]) {
    const hg = new THREE.Group();
    hg.position.set(-16.5, 0, hz);
    const hBox = new THREE.Mesh(new THREE.BoxGeometry(6.8, 2.5, 7.8), hangarWallMat);
    hBox.position.y = 1.25;
    hBox.castShadow = true;
    const hRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(3.9, 3.9, 6.9, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2),
      hangarRoofMat,
    );
    hRoof.scale.set(1, 0.45, 1);
    hRoof.position.y = 2.5;
    const hDoor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.0, 5.6), hangarDoorMat);
    hDoor.position.set(3.35, 1.0, 0);
    hg.add(hBox, hRoof, hDoor);
    airport.add(hg);
  }

  // Modern cam cepheli terminal binası + VFR Kontrol Kulesi
  const termWall = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 2.6, 9.0),
    new THREE.MeshLambertMaterial({ color: 0xebe8e0 }),
  );
  termWall.position.set(-16.5, 1.3, 0);
  termWall.castShadow = true;
  const termGlass = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.8, 7.6),
    new THREE.MeshLambertMaterial({ color: 0x244a6e }),
  );
  termGlass.position.set(-13.9, 1.2, 0);
  airport.add(termWall, termGlass);

  const tower = new THREE.Group();
  tower.position.set(-18.2, 0, 0);
  const tShaft = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 6.2, 2.4),
    new THREE.MeshLambertMaterial({ color: 0xebe8e0 }),
  );
  tShaft.position.y = 3.1;
  tShaft.castShadow = true;
  const tCab = new THREE.Mesh(
    new THREE.CylinderGeometry(2.15, 1.75, 1.55, 8),
    new THREE.MeshLambertMaterial({ color: 0x244869 }),
  );
  tCab.position.y = 6.95;
  const tRoof = new THREE.Mesh(
    new THREE.ConeGeometry(2.35, 0.75, 8),
    new THREE.MeshLambertMaterial({ color: 0xb83228 }),
  );
  tRoof.position.y = 8.1;
  const tBeacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x7aff98 }),
  );
  tBeacon.position.y = 8.65;
  tower.add(tShaft, tCab, tRoof, tBeacon);
  airport.add(tower);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8),
    new THREE.MeshLambertMaterial({ color: 0xd0d6dc }),
  );
  pole.position.set(8.5, 1.6, -18);
  airport.add(pole);
  const windsock = new THREE.Group();
  windsock.position.set(8.5, 3.1, -18);
  const sockGeo = new THREE.ConeGeometry(0.38, 1.6, 10, 1, true);
  sockGeo.rotateZ(-Math.PI / 2);
  sockGeo.translate(0.8, 0, 0);
  const sockMesh = new THREE.Mesh(
    sockGeo,
    new THREE.MeshLambertMaterial({ color: 0xff5a1f, side: THREE.DoubleSide }),
  );
  windsock.add(sockMesh);
  airport.add(windsock);
  group.add(airport);

  // ---- 2. Yolla %100 Hizalı 3B Taş Kemerli & Fenerli Köprü (BRIDGE_X, BRIDGE_Z) ----
  group.add(buildScenicBridge());

  // ---- 3. Kırsal Yel Değirmeni ----
  const wm = buildWindmill();
  group.add(wm.group);

  // Kıyı çizgisini (sampleWorldTerrain === 0) tam bulan yardımcı fonksiyon (iskele asla su ortasında kalmaz!)
  const findShoreX = (wz: number, dirX: -1 | 1): number => {
    let x = LAKE_X;
    for (let step = 0; step < 160; step++) {
      if (sampleWorldTerrain(x, wz) >= 0.05) return x;
      x += dirX * 0.5;
    }
    return x;
  };

  // ---- 4. Göl Doğu Kıyısında Ahşap İskele & Kayıkhane + Batı Kıyısında Ahşap Balıkçı İskelesi ----
  const eastShoreZ = LAKE_Z - 6;
  const eastShoreX = findShoreX(eastShoreZ, 1);
  const marinaGroup = new THREE.Group();
  marinaGroup.position.set(eastShoreX, WATER_Y, eastShoreZ);
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a5e3b });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5c3d24 });
  const woodDeck = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.24, 2.4), woodMat);
  woodDeck.position.set(-4.5, 0.42, 0);
  for (const px of [-9.5, -6.0, -2.5]) {
    for (const pz of [-0.95, 0.95]) {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6), postMat);
      piling.position.set(px, -0.2, pz);
      marinaGroup.add(piling);
    }
  }
  const lodgeWall = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 2.2, 3.8),
    new THREE.MeshLambertMaterial({ color: 0xf2eadb }),
  );
  lodgeWall.position.set(3.6, 1.5, 0);
  lodgeWall.castShadow = true;
  const lodgeRoof = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 1.55, 4).rotateY(Math.PI / 4),
    new THREE.MeshLambertMaterial({ color: 0xb8462c }),
  );
  lodgeRoof.position.set(3.6, 3.3, 0);
  marinaGroup.add(woodDeck, lodgeWall, lodgeRoof);
  group.add(marinaGroup);

  // Göl Batı kıyısında karaya tam oturan ikinci ahşap balıkçı iskelesi
  const westShoreZ = LAKE_Z - 12;
  const westShoreX = findShoreX(westShoreZ, -1);
  const westDock = new THREE.Group();
  westDock.position.set(westShoreX, WATER_Y, westShoreZ);
  const wdDeck = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.22, 2.0), woodMat);
  wdDeck.position.set(3.8, 0.38, 0);
  for (const px of [2.0, 5.0, 8.0]) {
    for (const pz of [-0.8, 0.8]) {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6), postMat);
      piling.position.set(px, -0.2, pz);
      westDock.add(piling);
    }
  }
  westDock.add(wdDeck);
  group.add(westDock);

  // ---- 5. Göl ve Nehir Boyunca Dağılmış 12 Adet Gerçekçi 3B Yelkenli, Gezi Teknesi ve Ahşap Kayık ----
  const addBoat = (mesh: THREE.Group, x: number, z: number, rotY: number, scale = 1.0) => {
    mesh.position.set(x, WATER_Y + 0.06, z);
    mesh.rotation.y = rotY;
    mesh.scale.setScalar(scale);
    group.add(mesh);
    boats.push(mesh);
  };

  const lakeMidX = (wz: number) => 0.5 * (findShoreX(wz, -1) + findShoreX(wz, 1));

  // Göl üzerindeki yelkenliler, gezi tekneleri ve iskele kayıkları (her zaman derin su merkezinde)
  addBoat(buildSailboatMesh(0xf4f6f9, 0x1d4ed8, 0xfaf6ec), lakeMidX(LAKE_Z - 10) + 7, LAKE_Z - 10, 0.55, 1.15);
  addBoat(buildSailboatMesh(0xfef3c7, 0xb91c1c, 0xfff8eb), lakeMidX(LAKE_Z + 5) - 5, LAKE_Z + 5, -0.85, 1.22);
  addBoat(buildSailboatMesh(0xf0fdf4, 0x0f766e, 0xfaf6ec), lakeMidX(LAKE_Z + 16) + 5, LAKE_Z + 16, 2.15, 1.08);
  addBoat(buildSailboatMesh(0xf4f6f9, 0x0369a1, 0xfef9c3), lakeMidX(LAKE_Z - 16) - 4, LAKE_Z - 16, 1.25, 1.12);
  addBoat(buildMotorLaunchMesh(0x1e3a8a), lakeMidX(LAKE_Z - 2) + 1, LAKE_Z - 2, -1.65, 1.15);
  addBoat(buildRowboatMesh(0x9a582c), eastShoreX - 9.2, eastShoreZ + 2.4, 1.45, 1.08);
  addBoat(buildRowboatMesh(0x7c4320), westShoreX + 7.8, westShoreZ + 2.1, -1.35, 1.08);

  // Kıvrımlı 3B Nehir boyunca seyreden yelkenliler, motorlu gezi tekneleri ve balıkçı sandalları
  addBoat(buildSailboatMesh(0xffffff, 0xb91c1c, 0xfffef7), getRiverCenterX(-92) - 2, -92, 0.25, 1.12);
  addBoat(buildMotorLaunchMesh(0x0f766e), getRiverCenterX(-138) + 2, -138, 3.05, 1.15);
  addBoat(buildRowboatMesh(0x8f532a), getRiverCenterX(14) - 3.5, 14, 0.45, 1.1);
  addBoat(buildSailboatMesh(0xfef9c3, 0x1e40af, 0xffffff), getRiverCenterX(96) + 1.5, 96, -2.75, 1.18);
  addBoat(buildMotorLaunchMesh(0x991b1b), getRiverCenterX(148) - 1.5, 148, 0.18, 1.12);

  return { group, windsock, beacon: tBeacon, boats, windmillBlades: wm.blades };
}

interface SceneryItem {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  tint: number;
}

interface Veg extends SceneryItem {
  kind: 0 | 1; // 0 = çam, 1 = yapraklı
}

/** Suyun içinde, asfalt yolda veya havaalanı platosunda ağaç/ev/çalı çıkmasını önler. */
function isValidLandSpot(wx: number, wz: number, minWaterDist = 3.5, minRoadDist = 5.0): boolean {
  const { dist: waterDist } = getRiverHalfWidth(wx, wz);
  if (waterDist < minWaterDist) return false;
  if (getRoadDistance(wx, wz) < minRoadDist) return false;
  if (Math.abs(wrapWorldDelta(wx - AIRFIELD_X)) < 30 && Math.abs(wrapWorldDelta(wz - AIRFIELD_Z)) < 76) {
    return false;
  }
  if (Math.abs(wrapWorldDelta(wx - BRIDGE_X)) < 32 && Math.abs(wrapWorldDelta(wz - BRIDGE_Z)) < 10) {
    return false;
  }
  return true;
}

function scatterVegetation(): Veg[] {
  const out: Veg[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clusters: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < 165; i++) {
    clusters.push({
      x: (rnd() - 0.5) * SCENERY_SIZE,
      z: (rnd() - 0.5) * SCENERY_SIZE,
      r: 14 + rnd() * 44,
    });
  }
  // Canlı Ghibli / Japon kırsalı renk tonları (bahar yeşili, güneşli altın-yeşil ve hafif kiraz çiçeği/sakura esintisi)
  const pineTints = [0xffffff, 0xeafae6, 0xd8f2d2, 0xf2fae8];
  const leafTints = [0xffffff, 0xf0fae2, 0xe2f5d0, 0xfff5d6, 0xebf7c8, 0xffdfeb];

  // 1. Nehir ve göl kıyısı boyunca doğal kıyı ağaçları (söğüt/çınar/sakura dizisi)
  for (let i = 0; i < 360; i++) {
    const vz = (rnd() - 0.5) * SCENERY_SIZE;
    const side = rnd() < 0.5 ? -1 : 1;
    const vx = wrapWorldDelta(getRiverCenterX(vz) + side * (15 + rnd() * 24));
    if (!isValidLandSpot(vx, vz, 2.8, 5.2)) continue;
    const vy = sampleWorldTerrain(vx, vz);
    if (vy < WATER_Y + 0.3 || vy > 18) continue;
    const kind: 0 | 1 = rnd() < 0.8 ? 1 : 0;
    const tints = kind === 0 ? pineTints : leafTints;
    out.push({
      x: vx,
      y: vy - 0.12,
      z: vz,
      s: 0.78 + rnd() * 1.25,
      rot: rnd() * Math.PI * 2,
      tint: tints[(rnd() * tints.length) | 0],
      kind,
    });
  }

  // 2. Vadi koridoru ve dağ yamaçları boyunca doğal orman kümeleri
  for (let i = 0; i < 1350; i++) {
    const cl = clusters[(rnd() * clusters.length) | 0];
    const vx = wrapWorldDelta(cl.x + (rnd() + rnd() - 1) * cl.r);
    const vz = wrapWorldDelta(cl.z + (rnd() + rnd() - 1) * cl.r);
    if (!isValidLandSpot(vx, vz, 3.2, 5.2)) continue;
    const vy = sampleWorldTerrain(vx, vz);
    if (vy < WATER_Y + 0.35 || vy > 29) continue;
    const kind: 0 | 1 = vy > 12 || i < 680 ? 0 : 1;
    const tints = kind === 0 ? pineTints : leafTints;
    out.push({
      x: vx,
      y: vy - 0.12,
      z: vz,
      s: 0.72 + rnd() * 1.35,
      rot: rnd() * Math.PI * 2,
      tint: tints[(rnd() * tints.length) | 0],
      kind,
    });
  }
  return out;
}

/** Nehir kıyıları, çayırlar ve yamaçlar boyunca 3B çalılar, ot/çimen demetleri ve kayalar üretir. */
function scatterGroundFoliage(): {
  bushes: SceneryItem[];
  grasses: SceneryItem[];
  rocks: SceneryItem[];
} {
  const bushes: SceneryItem[] = [];
  const grasses: SceneryItem[] = [];
  const rocks: SceneryItem[] = [];
  let seed = 313;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const bushTints = [0xffffff, 0xe5f5dc, 0xd8ebd0, 0xf5ebd6, 0xebf2d5];
  const grassTints = [0xffffff, 0xeaf5d8, 0xf5f0c8, 0xdcebd0, 0xe3f2c4];
  const rockTints = [0xffffff, 0xe8ecee, 0xf0ebe2, 0xdde3dc];

  // ~2.400 adet 3B Çalı Kümesi (nehir kıyıları + vadi çayırları + orman etekleri)
  for (let i = 0; i < 2700; i++) {
    const inValley = i < 1400;
    const span = inValley ? 380 : SCENERY_SIZE;
    const bx = (rnd() - 0.5) * span;
    const bz = (rnd() - 0.5) * span;
    if (!isValidLandSpot(bx, bz, 1.0, 4.0)) continue;
    const by = sampleWorldTerrain(bx, bz);
    if (by < WATER_Y + 0.12 || by > 26) continue;
    bushes.push({
      x: bx,
      y: by - 0.08,
      z: bz,
      s: 0.7 + rnd() * 1.4,
      rot: rnd() * Math.PI * 2,
      tint: bushTints[(rnd() * bushTints.length) | 0],
    });
  }

  // ~6.200 adet 3B Ot / Çimen / Kır Çiçeği / Kıyı Sazlığı Demeti
  for (let i = 0; i < 6800; i++) {
    const inValley = i < 4200;
    const span = inValley ? 340 : SCENERY_SIZE;
    const gx = (rnd() - 0.5) * span;
    const gz = (rnd() - 0.5) * span;
    if (!isValidLandSpot(gx, gz, 0.25, 3.5)) continue;
    const gy = sampleWorldTerrain(gx, gz);
    if (gy < WATER_Y + 0.04 || gy > 24) continue;
    grasses.push({
      x: gx,
      y: gy - 0.04,
      z: gz,
      s: 0.65 + rnd() * 1.05,
      rot: rnd() * Math.PI * 2,
      tint: grassTints[(rnd() * grassTints.length) | 0],
    });
  }

  // ~550 adet 3B Nehir Kayası ve Yamaç Kayalığı
  for (let i = 0; i < 620; i++) {
    const inValley = i < 300;
    const span = inValley ? 360 : SCENERY_SIZE;
    const rx = (rnd() - 0.5) * span;
    const rz = (rnd() - 0.5) * span;
    if (!isValidLandSpot(rx, rz, 0.15, 4.2)) continue;
    const ry = sampleWorldTerrain(rx, rz);
    if (ry < WATER_Y + 0.02) continue;
    rocks.push({
      x: rx,
      y: ry - 0.08,
      z: rz,
      s: 0.6 + rnd() * 1.6,
      rot: rnd() * Math.PI * 2,
      tint: rockTints[(rnd() * rockTints.length) | 0],
    });
  }

  return { bushes, grasses, rocks };
}

type House = SceneryItem;

function scatterHouses(): House[] {
  const out: House[] = [];
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const houseTints = [0xffffff, 0xfaf3e8, 0xf2e8dc, 0xeef2f5];
  for (let i = 0; i < 110; i++) {
    const hx = (rnd() - 0.5) * SCENERY_SIZE;
    const hz = (rnd() - 0.5) * SCENERY_SIZE;
    if (!isValidLandSpot(hx, hz, 8.0, 5.5)) continue;
    const hy = sampleWorldTerrain(hx, hz);
    const n = sampleTerrainNormal(hx, hz);
    if (hy < WATER_Y + 0.7 || hy > 14 || n.y < 0.94) continue;
    out.push({
      x: hx,
      y: hy - 0.15,
      z: hz,
      s: 0.82 + rnd() * 0.6,
      rot: rnd() * Math.PI * 2,
      tint: houseTints[(rnd() * houseTints.length) | 0],
    });
  }
  return out;
}

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

export type CamMode = 'chase' | 'top' | 'orbit';

/** İki nokta arasına aerodinamik profilli veya silindirik dikme (strut) yerleştirir. */
function strut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  mat: THREE.Material,
  chordScale = 1,
): THREE.Mesh {
  const dir = b.clone().sub(a);
  const geo = new THREE.CylinderGeometry(r, r, dir.length(), 16);
  if (chordScale !== 1) {
    geo.scale(1, 1, chordScale);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/**
 * NACA 4-haneli (ör. NACA 2412 veya simetrik 0009) kanat profili koordinatlarını hesaplar.
 * s = 0 hücum kenarı (LE), s = 1 firar kenarı (TE).
 */
function sampleNacaAirfoil(s: number, maxCamber = 0.02, camberPos = 0.4, thickness = 0.12) {
  const x = clamp(s, 0, 1);
  const yt =
    5 *
    thickness *
    (0.2969 * Math.sqrt(x) -
      0.126 * x -
      0.3516 * x * x +
      0.2843 * x * x * x -
      0.1015 * x * x * x * x);
  let yc = 0;
  if (maxCamber > 0 && camberPos > 0 && camberPos < 1) {
    if (x < camberPos) {
      yc = (maxCamber / (camberPos * camberPos)) * (2 * camberPos * x - x * x);
    } else {
      const d = 1 - camberPos;
      yc = (maxCamber / (d * d)) * (1 - 2 * camberPos + 2 * camberPos * x - x * x);
    }
  }
  return {
    yu: yc + yt,
    yl: yc - yt,
  };
}

/**
 * Yatay kanat, yatay stabilize, flap, aileron ve elevatör için birleşik NACA airfoil loft üreticisi.
 * [sMin, sMax] aralığını örnekler:
 * - Ana kanat: sMin = 0, sMax = 0.74
 * - Flap / Aileron: sMin = 0.74, sMax = 1.0 (menteşe noktasında yuvarlatılmış burun ile)
 * Böylece kanat ve kontrol yüzeyleri aynı NACA profilinden kesildiği için aralarında sıfır boşluk/basamak oluşur.
 */
function buildHorizontalAirfoilSegment(
  x0: number,
  x1: number,
  zLE0: number,
  chord0: number,
  thick0: number,
  zLE1: number,
  chord1: number,
  thick1: number,
  camber = 0.02,
  sMin = 0.0,
  sMax = 1.0,
  refY = 0.0,
  refZ = 0.0,
  includeCaps = true,
): THREE.BufferGeometry {
  const nSteps = 22;
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const leftParams = x0 <= x1 ? [zLE0, chord0, thick0] : [zLE1, chord1, thick1];
  const rightParams = x0 <= x1 ? [zLE1, chord1, thick1] : [zLE0, chord0, thick0];

  const sampleSide = (zLE: number, chord: number, thick: number) => {
    const upper: [number, number][] = [];
    const lower: [number, number][] = [];
    for (let i = 0; i <= nSteps; i++) {
      const t = i / nSteps;
      const s = sMin + t * (sMax - sMin);
      const p = sampleNacaAirfoil(s, camber, 0.4, thick);
      if (i === 0 && sMin > 0) {
        const yMid = (p.yu + p.yl) * 0.5;
        upper.push([(yMid + (p.yu - yMid) * 0.85) * chord - refY, zLE + s * chord - refZ]);
        lower.push([(yMid + (p.yl - yMid) * 0.85) * chord - refY, zLE + s * chord - refZ]);
      } else {
        upper.push([p.yu * chord - refY, zLE + s * chord - refZ]);
        lower.push([p.yl * chord - refY, zLE + s * chord - refZ]);
      }
    }
    return { upper, lower };
  };

  const L = sampleSide(leftParams[0], leftParams[1], leftParams[2]);
  const R = sampleSide(rightParams[0], rightParams[1], rightParams[2]);

  const positions: number[] = [];
  const indices: number[] = [];

  const pushVert = (x: number, y: number, z: number) => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    return idx;
  };

  // Ana aerodinamik kabuk (kapak normallerinden tamamen izole: sıfır gölge dikişi!)
  // sMin === 0 ise hücum kenarı (i = 0) üst ve alt kabuk arasında ortak kullanılır (yuvarlak burun normali)
  const uL: number[] = [];
  const uR: number[] = [];
  const lL: number[] = [];
  const lR: number[] = [];

  for (let i = 0; i <= nSteps; i++) {
    uL.push(pushVert(xa, L.upper[i][0], L.upper[i][1]));
    uR.push(pushVert(xb, R.upper[i][0], R.upper[i][1]));
  }
  for (let i = 0; i <= nSteps; i++) {
    if (i === 0 && sMin === 0) {
      lL.push(uL[0]);
      lR.push(uR[0]);
    } else {
      lL.push(pushVert(xa, L.lower[i][0], L.lower[i][1]));
      lR.push(pushVert(xb, R.lower[i][0], R.lower[i][1]));
    }
  }

  // Üst kabuk üçgenleri (normal +Y)
  for (let i = 0; i < nSteps; i++) {
    indices.push(uL[i], uL[i + 1], uR[i + 1], uL[i], uR[i + 1], uR[i]);
  }
  // Alt kabuk üçgenleri (normal -Y)
  for (let i = 0; i < nSteps; i++) {
    indices.push(lL[i], lR[i + 1], lL[i + 1], lL[i], lR[i], lR[i + 1]);
  }

  const addFlatQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
  ) => {
    const a = pushVert(p0[0], p0[1], p0[2]);
    const b = pushVert(p1[0], p1[1], p1[2]);
    const c = pushVert(p2[0], p2[1], p2[2]);
    const d = pushVert(p3[0], p3[1], p3[2]);
    indices.push(a, b, c, a, c, d);
  };

  if (includeCaps) {
    // Ön lonjeron kapağı (sMin > 0 ise)
    if (sMin > 0) {
      addFlatQuad(
        [xa, L.upper[0][0], L.upper[0][1]],
        [xb, R.upper[0][0], R.upper[0][1]],
        [xb, R.lower[0][0], R.lower[0][1]],
        [xa, L.lower[0][0], L.lower[0][1]],
      );
    }
    // Arka firar/lonjeron kapağı
    addFlatQuad(
      [xa, L.lower[nSteps][0], L.lower[nSteps][1]],
      [xb, R.lower[nSteps][0], R.lower[nSteps][1]],
      [xb, R.upper[nSteps][0], R.upper[nSteps][1]],
      [xa, L.upper[nSteps][0], L.upper[nSteps][1]],
    );

    // Sol (-X) ve Sağ (+X) yan kapaklar (ayrı köşelerle düz yüzey normali)
    for (let i = 0; i < nSteps; i++) {
      addFlatQuad(
        [xa, L.upper[i][0], L.upper[i][1]],
        [xa, L.lower[i][0], L.lower[i][1]],
        [xa, L.lower[i + 1][0], L.lower[i + 1][1]],
        [xa, L.upper[i + 1][0], L.upper[i + 1][1]],
      );
      addFlatQuad(
        [xb, R.upper[i][0], R.upper[i][1]],
        [xb, R.upper[i + 1][0], R.upper[i + 1][1]],
        [xb, R.lower[i + 1][0], R.lower[i + 1][1]],
        [xb, R.lower[i][0], R.lower[i][1]],
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Dikey stabilize (Fin) ve Rudder için simetrik NACA 0009 airfoil loft üreticisi.
 * Yan kabuk normalleri kapaklardan tamamen ayrılmıştır; böylece Fin, Rudder ve şeritler pürüzsüz görünür.
 */
function buildVerticalAirfoilSegment(
  y0: number,
  y1: number,
  zLE0: number,
  chord0: number,
  thick0: number,
  zLE1: number,
  chord1: number,
  thick1: number,
  sMin = 0.0,
  sMax = 1.0,
  refY = 0.0,
  refZ = 0.0,
  extraWidth = 0.0,
  includeCaps = true,
): THREE.BufferGeometry {
  const nSteps = 20;
  const ya = y0 - refY;
  const yb = y1 - refY;

  const sampleSide = (zLE: number, chord: number, thick: number) => {
    const right: [number, number][] = [];
    const left: [number, number][] = [];
    for (let i = 0; i <= nSteps; i++) {
      const t = i / nSteps;
      const s = sMin + t * (sMax - sMin);
      const p = sampleNacaAirfoil(s, 0, 0.4, thick);
      const halfW = p.yu * chord + extraWidth;
      right.push([halfW, zLE + s * chord - refZ]);
      left.push([-halfW, zLE + s * chord - refZ]);
    }
    return { right, left };
  };

  const B = sampleSide(zLE0, chord0, thick0);
  const T = sampleSide(zLE1, chord1, thick1);

  const positions: number[] = [];
  const indices: number[] = [];

  const pushVert = (x: number, y: number, z: number) => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    return idx;
  };

  const rB: number[] = [];
  const rT: number[] = [];
  const lB: number[] = [];
  const lT: number[] = [];

  for (let i = 0; i <= nSteps; i++) {
    rB.push(pushVert(B.right[i][0], ya, B.right[i][1]));
    rT.push(pushVert(T.right[i][0], yb, T.right[i][1]));
  }
  for (let i = 0; i <= nSteps; i++) {
    if (i === 0 && sMin === 0 && extraWidth === 0) {
      lB.push(rB[0]);
      lT.push(rT[0]);
    } else {
      lB.push(pushVert(B.left[i][0], ya, B.left[i][1]));
      lT.push(pushVert(T.left[i][0], yb, T.left[i][1]));
    }
  }

  // Sağ kabuk (+X normali: +Y x +Z = +X)
  for (let i = 0; i < nSteps; i++) {
    indices.push(rB[i], rT[i], rT[i + 1], rB[i], rT[i + 1], rB[i + 1]);
  }
  // Sol kabuk (-X normali: +Z x +Y = -X)
  for (let i = 0; i < nSteps; i++) {
    indices.push(lB[i], lB[i + 1], lT[i + 1], lB[i], lT[i + 1], lT[i]);
  }

  const addFlatQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
  ) => {
    const a = pushVert(p0[0], p0[1], p0[2]);
    const b = pushVert(p1[0], p1[1], p1[2]);
    const c = pushVert(p2[0], p2[1], p2[2]);
    const d = pushVert(p3[0], p3[1], p3[2]);
    indices.push(a, b, c, a, c, d);
  };

  if (includeCaps) {
    if (sMin > 0) {
      addFlatQuad(
        [B.right[0][0], ya, B.right[0][1]],
        [B.left[0][0], ya, B.left[0][1]],
        [T.left[0][0], yb, T.left[0][1]],
        [T.right[0][0], yb, T.right[0][1]],
      );
    }
    addFlatQuad(
      [B.left[nSteps][0], ya, B.left[nSteps][1]],
      [B.right[nSteps][0], ya, B.right[nSteps][1]],
      [T.right[nSteps][0], yb, T.right[nSteps][1]],
      [T.left[nSteps][0], yb, T.left[nSteps][1]],
    );
    for (let i = 0; i < nSteps; i++) {
      // Alt kapak (-Y)
      addFlatQuad(
        [B.right[i][0], ya, B.right[i][1]],
        [B.right[i + 1][0], ya, B.right[i + 1][1]],
        [B.left[i + 1][0], ya, B.left[i + 1][1]],
        [B.left[i][0], ya, B.left[i][1]],
      );
      // Üst kapak (+Y)
      addFlatQuad(
        [T.right[i][0], yb, T.right[i][1]],
        [T.left[i][0], yb, T.left[i][1]],
        [T.left[i + 1][0], yb, T.left[i + 1][1]],
        [T.right[i + 1][0], yb, T.right[i + 1][1]],
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface FusStation {
  z: number;
  yBot: number;
  yTop: number;
  wBot: number;
  wTop: number;
  pX: number;
  pY: number;
}

/**
 * Cessna 172 Skyhawk gövde istasyonları:
 * Burun motor kaportasından (z = -2.56) ön cama, yüksek kanat kabin tavanına ve
 * kuyruk konisi ucuna (z = +2.84) kadar pürüzsüz kesit geçişi sağlar.
 */
const FUS_STATIONS: FusStation[] = [
  { z: -2.56, yBot: -0.2, yTop: 0.14, wBot: 0.23, wTop: 0.25, pX: 0.86, pY: 0.86 },
  { z: -2.44, yBot: -0.27, yTop: 0.2, wBot: 0.34, wTop: 0.36, pX: 0.78, pY: 0.78 },
  { z: -2.26, yBot: -0.32, yTop: 0.24, wBot: 0.39, wTop: 0.4, pX: 0.74, pY: 0.75 },
  { z: -2.04, yBot: -0.35, yTop: 0.265, wBot: 0.425, wTop: 0.435, pX: 0.71, pY: 0.73 },
  { z: -1.66, yBot: -0.38, yTop: 0.29, wBot: 0.45, wTop: 0.46, pX: 0.68, pY: 0.72 },
  // Ön cam (windshield) eğimiyle kabin tavanına pürüzsüz doğrusal yükseliş
  { z: -1.38, yBot: -0.39, yTop: 0.47, wBot: 0.46, wTop: 0.44, pX: 0.65, pY: 0.68 },
  { z: -1.12, yBot: -0.4, yTop: 0.635, wBot: 0.46, wTop: 0.43, pX: 0.62, pY: 0.66 },
  // Ana kabin (üstten kanatla bütünleşik)
  { z: -0.48, yBot: -0.4, yTop: 0.65, wBot: 0.46, wTop: 0.43, pX: 0.62, pY: 0.66 },
  { z: 0.08, yBot: -0.37, yTop: 0.615, wBot: 0.43, wTop: 0.4, pX: 0.64, pY: 0.68 },
  // Arka panoramik cam (Omni-Vision) inişi
  { z: 0.54, yBot: -0.31, yTop: 0.35, wBot: 0.36, wTop: 0.33, pX: 0.72, pY: 0.74 },
  // Kuyruk konisi (yatay stabilize ve fin kökünü tam sarar)
  { z: 1.25, yBot: -0.22, yTop: 0.27, wBot: 0.25, wTop: 0.22, pX: 0.84, pY: 0.84 },
  { z: 1.98, yBot: -0.13, yTop: 0.21, wBot: 0.15, wTop: 0.13, pX: 0.9, pY: 0.9 },
  { z: 2.52, yBot: -0.05, yTop: 0.18, wBot: 0.07, wTop: 0.06, pX: 0.95, pY: 0.95 },
  { z: 2.84, yBot: 0.04, yTop: 0.15, wBot: 0.012, wTop: 0.012, pX: 1.0, pY: 1.0 },
];

/** Gövde ve tüm conformal yamalar/şeritler için ortak z istasyon dizisi üretir (sıfır gövde taşması!). */
function getDenseFuselageZs(): number[] {
  const zs: number[] = [];
  for (let i = 0; i < FUS_STATIONS.length - 1; i++) {
    const a = FUS_STATIONS[i].z;
    const b = FUS_STATIONS[i + 1].z;
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      zs.push(a + ((b - a) * k) / steps);
    }
  }
  zs.push(FUS_STATIONS[FUS_STATIONS.length - 1].z);
  return zs;
}

const DENSE_FUS_ZS = getDenseFuselageZs();

/** Verilen [z0, z1] aralığında gövde istasyonlarıyla birebir çakışan z kesit listesi döndürür. */
function getSubgridZs(z0: number, z1: number, minSteps = 12): number[] {
  const set = new Set<number>([z0, z1]);
  for (const z of DENSE_FUS_ZS) {
    if (z > z0 + 1e-4 && z < z1 - 1e-4) set.add(z);
  }
  for (let i = 1; i < minSteps; i++) {
    set.add(z0 + ((z1 - z0) * i) / minSteps);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Herhangi bir z koordinatında gövde kesit parametrelerini doğrusal enterpolasyonla hesaplar. */
function sampleFusStation(z: number): FusStation {
  if (z <= FUS_STATIONS[0].z) return FUS_STATIONS[0];
  const last = FUS_STATIONS[FUS_STATIONS.length - 1];
  if (z >= last.z) return last;
  for (let i = 0; i < FUS_STATIONS.length - 1; i++) {
    const a = FUS_STATIONS[i];
    const b = FUS_STATIONS[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / Math.max(1e-5, b.z - a.z);
      return {
        z,
        yBot: a.yBot + (b.yBot - a.yBot) * t,
        yTop: a.yTop + (b.yTop - a.yTop) * t,
        wBot: a.wBot + (b.wBot - a.wBot) * t,
        wTop: a.wTop + (b.wTop - a.wTop) * t,
        pX: a.pX + (b.pX - a.pX) * t,
        pY: a.pY + (b.pY - a.pY) * t,
      };
    }
  }
  return last;
}

function evalFusStation(st: FusStation, theta: number, radialOffset = 0): [number, number, number] {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const sgnS = s >= 0 ? 1 : -1;
  const sgnC = c >= 0 ? 1 : -1;
  const ny = sgnC * Math.pow(Math.abs(c), st.pY);
  const nx = sgnS * Math.pow(Math.abs(s), st.pX);
  const yMid = (st.yTop + st.yBot) * 0.5;
  const yHalf = (st.yTop - st.yBot) * 0.5;
  const y = yMid + ny * (yHalf + radialOffset);
  const tHeight = clamp((ny + 1) * 0.5, 0, 1);
  const w = st.wBot + (st.wTop - st.wBot) * tHeight;
  const x = nx * (w + radialOffset);
  return [x, y, st.z];
}

/**
 * Çok istasyonlu (lofted) pürüzsüz beyaz gövde geometrisini oluşturur.
 */
function buildLoftedFuselageGeo(): THREE.BufferGeometry {
  const radialSegs = 56;
  const denseStations = DENSE_FUS_ZS.map((z) => sampleFusStation(z));
  const stCount = denseStations.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < stCount; i++) {
    const st = denseStations[i];
    for (let j = 0; j <= radialSegs; j++) {
      const theta = (j / radialSegs) * Math.PI * 2;
      const [px, py, pz] = evalFusStation(st, theta, 0);
      positions.push(px, py, pz);
    }
  }

  const row = radialSegs + 1;
  for (let i = 0; i < stCount - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + (j + 1);
      const d = i * row + (j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }

  // Ön ve arka kapaklar (ayrı köşelerle gövde normallerini bozmaz)
  const frontCenter = positions.length / 3;
  positions.push(0, -0.02, denseStations[0].z);
  for (let j = 0; j < radialSegs; j++) {
    const th0 = (j / radialSegs) * Math.PI * 2;
    const th1 = ((j + 1) / radialSegs) * Math.PI * 2;
    const p0 = evalFusStation(denseStations[0], th0, 0);
    const p1 = evalFusStation(denseStations[0], th1, 0);
    const i0 = positions.length / 3;
    positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
    indices.push(frontCenter, i0, i0 + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Gövde yüzeyine (z, theta) koordinatlarında tam oturan (conformal) 3B yama üretir.
 * Gövde z istasyonlarıyla birebir hizalandığı için hiçbir noktada gövde içinden geçmez.
 */
function buildFuselageAngularPatch(
  z0: number,
  z1: number,
  theta0Fn: (tZ: number) => number,
  theta1Fn: (tZ: number) => number,
  offset = 0.0045,
  minZSteps = 14,
  tSteps = 20,
): THREE.BufferGeometry {
  const zs = getSubgridZs(z0, z1, minZSteps);
  const zCount = zs.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < zCount; i++) {
    const z = zs[i];
    const tz = (z - z0) / Math.max(1e-5, z1 - z0);
    const st = sampleFusStation(z);
    const thA = theta0Fn(tz);
    const thB = theta1Fn(tz);
    for (let j = 0; j <= tSteps; j++) {
      const tt = j / tSteps;
      const theta = thA + (thB - thA) * tt;
      const [px, py, pz] = evalFusStation(st, theta, offset);
      positions.push(px, py, pz);
    }
  }

  const row = tSteps + 1;
  for (let i = 0; i < zCount - 1; i++) {
    for (let j = 0; j < tSteps; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + (j + 1);
      const d = i * row + (j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Gövdenin sağ (+1) veya sol (-1) yan yüzeyinde [yBotFn(z), yTopFn(z)] şeridini
 * gövde z-istasyonlarına 100% kilitli 3B conformal mesh olarak üretir.
 * UV koordinatları doğrusal (z, y) uzayında üretildiği için TC-TSI yazısı sıfır bozulmayla basılır.
 */
function buildFuselageSideRibbon(
  side: 1 | -1,
  z0: number,
  z1: number,
  yBotFn: (z: number) => number,
  yTopFn: (z: number) => number,
  offset = 0.0045,
  minZSteps = 24,
  ySteps = 8,
): THREE.BufferGeometry {
  const zs = getSubgridZs(z0, z1, minZSteps);
  const zCount = zs.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < zCount; i++) {
    const z = zs[i];
    const tz = (z - z0) / Math.max(1e-5, z1 - z0);
    const st = sampleFusStation(z);
    const yMid = (st.yTop + st.yBot) * 0.5;
    const yHalf = Math.max(0.01, (st.yTop - st.yBot) * 0.5);
    const yA = yBotFn(z);
    const yB = yTopFn(z);

    for (let j = 0; j <= ySteps; j++) {
      const ty = j / ySteps;
      const yTarget = side === 1 ? yB + (yA - yB) * ty : yA + (yB - yA) * ty;
      const ny = clamp((yTarget - yMid) / yHalf, -0.94, 0.94);
      const sgnC = ny >= 0 ? 1 : -1;
      const cosT = clamp(sgnC * Math.pow(Math.abs(ny), 1 / st.pY), -0.992, 0.992);
      const theta = side === 1 ? Math.acos(cosT) : Math.PI * 2 - Math.acos(cosT);
      const [px, py, pz] = evalFusStation(st, theta, offset);
      positions.push(px, py, pz);
      const u = side === 1 ? 1 - tz : tz;
      const v = side === 1 ? 1 - ty : ty;
      uvs.push(u, v);
    }
  }

  const row = ySteps + 1;
  for (let i = 0; i < zCount - 1; i++) {
    for (let j = 0; j < ySteps; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = (i + 1) * row + (j + 1);
      const d = i * row + (j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Kuyruk konisi yan yüzeyi için jilet gibi keskin TC-TSI tescil yazısı dokusu. */
function tailRegTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = 'italic bold 82px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#182b49';
  ctx.fillText('TC-TSI', 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dönen pervane diski için hafif ve doğal radyal bulanıklık (motion blur) dokusu. */
function propBlurTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const cx = 128;
  const cy = 128;

  const baseGrad = x.createRadialGradient(cx, cy, 16, cx, cy, 122);
  baseGrad.addColorStop(0, 'rgba(30, 34, 40, 0.0)');
  baseGrad.addColorStop(0.22, 'rgba(40, 45, 52, 0.14)');
  baseGrad.addColorStop(0.82, 'rgba(60, 66, 74, 0.09)');
  baseGrad.addColorStop(0.94, 'rgba(245, 197, 24, 0.18)');
  baseGrad.addColorStop(1, 'rgba(245, 197, 24, 0.0)');
  x.fillStyle = baseGrad;
  x.beginPath();
  x.arc(cx, cy, 124, 0, Math.PI * 2);
  x.fill();

  for (const ang of [0, Math.PI]) {
    x.save();
    x.translate(cx, cy);
    x.rotate(ang);
    const bladeGrad = x.createLinearGradient(0, -120, 0, 120);
    bladeGrad.addColorStop(0, 'rgba(245, 197, 24, 0.28)');
    bladeGrad.addColorStop(0.1, 'rgba(35, 40, 46, 0.22)');
    bladeGrad.addColorStop(0.5, 'rgba(35, 40, 46, 0.05)');
    bladeGrad.addColorStop(0.9, 'rgba(35, 40, 46, 0.22)');
    bladeGrad.addColorStop(1, 'rgba(245, 197, 24, 0.28)');
    x.fillStyle = bladeGrad;
    x.beginPath();
    x.moveTo(0, 0);
    x.arc(0, 0, 120, -Math.PI / 2 - 0.2, -Math.PI / 2 + 0.2);
    x.closePath();
    x.fill();
    x.restore();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Tekerlek karenajı (Wheel Pant / Speed Fairing):
 * Kırmızı yan şerit, karenajın kendi Lathe istasyonlarıyla birebir aynı z düğümlerini ve
 * tam acos(y/r) açısını kullanarak üretilir; böylece ne kutu taşması ne de tırtıklı kenar oluşur!
 */
function buildWheelPantGroup(
  scale: number,
  whiteMat: THREE.Material,
  redMat: THREE.Material,
  tyreMat: THREE.Material,
  hubMat: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();

  const pantProfile: [number, number][] = [
    [0.005, -0.44],
    [0.11, -0.38],
    [0.185, -0.25],
    [0.22, -0.08],
    [0.215, 0.1],
    [0.18, 0.26],
    [0.12, 0.4],
    [0.055, 0.5],
    [0.005, 0.56],
  ];
  const pantGeo = new THREE.LatheGeometry(
    pantProfile.map(([r, y]) => new THREE.Vector2(r, y)),
    32,
  );
  pantGeo.rotateX(Math.PI / 2);
  pantGeo.scale(0.62, 1.0, 1.0);
  pantGeo.translate(0, 0.05, 0.02);
  g.add(new THREE.Mesh(pantGeo, whiteMat));

  // Sağ ve sol yüzeyde pantProfile istasyonlarına birebir kilitli jilet gibi düz kırmızı kuşak
  const stripeStations = pantProfile.slice(1, 7); // z = -0.38 .. +0.40
  const ySteps = 6;
  for (const side of [-1, 1] as (-1 | 1)[]) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < stripeStations.length; i++) {
      const [rBase, zLocal] = stripeStations[i];
      const rOut = rBase + 0.004;
      const u = i / (stripeStations.length - 1);
      const yCenter = 0.01 - u * 0.015;
      const halfH = 0.026 * (1 - u * 0.28);
      const yA = yCenter - halfH;
      const yB = yCenter + halfH;
      for (let j = 0; j <= ySteps; j++) {
        const ty = j / ySteps;
        const yRel = side === 1 ? yB + (yA - yB) * ty : yA + (yB - yA) * ty;
        const cosA = clamp(yRel / rOut, -0.92, 0.92);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const px = side * sinA * rOut * 0.62;
        const py = cosA * rOut + 0.05;
        const pz = zLocal + 0.02;
        pos.push(px, py, pz);
      }
    }
    const row = ySteps + 1;
    for (let i = 0; i < stripeStations.length - 1; i++) {
      for (let j = 0; j < ySteps; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        const c = (i + 1) * row + (j + 1);
        const d = i * row + (j + 1);
        idx.push(a, b, c, a, c, d);
      }
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sGeo.setIndex(idx);
    sGeo.computeVertexNormals();
    g.add(new THREE.Mesh(sGeo, redMat));
  }

  // Alttan çıkan kauçuk uçak lastiği ve parlak jant göbeği
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.125, 24).rotateZ(Math.PI / 2),
    tyreMat,
  );
  wheel.position.set(0, -0.055, -0.02);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.085, 0.14, 16).rotateZ(Math.PI / 2),
    hubMat,
  );
  hub.position.copy(wheel.position);
  g.add(wheel, hub);

  g.scale.setScalar(scale);
  return g;
}

function buildAircraft() {
  // group: konum + yaw (heading/sideslip); body: pitch + bank
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Ortam haritası (envMap) olmadan siyahlaşmayı önlemek için metalness <= 0.18 tutulur
  const paint = (color: number, rough = 0.3, metal = 0.06, polyOffset = false) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      polygonOffset: polyOffset,
      polygonOffsetFactor: polyOffset ? -1 : 0,
      polygonOffsetUnits: polyOffset ? -1 : 0,
    });
  const white = paint(0xf4f6f9, 0.28, 0.06);
  const red = paint(0xc81e28, 0.3, 0.08);
  const redDecal = paint(0xc81e28, 0.3, 0.08, true);
  const navyDecal = paint(0x182b49, 0.32, 0.08, true);
  const goldDecal = paint(0xd8a642, 0.28, 0.16, true);
  const antiGlareMat = paint(0x232931, 0.65, 0.04, true);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x162636,
    roughness: 0.12,
    metalness: 0.18,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const regMat = new THREE.MeshStandardMaterial({
    map: tailRegTexture(),
    transparent: true,
    roughness: 0.3,
    metalness: 0.06,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const silver = paint(0xdce2ea, 0.22, 0.18);
  const dark = paint(0x1e2228, 0.5, 0.08);
  const yellow = paint(0xf5c518, 0.35, 0.05);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.85, metalness: 0.02 });
  const navRed = new THREE.MeshStandardMaterial({
    color: 0x5a0b0b,
    emissive: 0xff2222,
    emissiveIntensity: 2.0,
  });
  const navGreen = new THREE.MeshStandardMaterial({
    color: 0x0b5a12,
    emissive: 0x22ff44,
    emissiveIntensity: 2.0,
  });
  const navWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.5,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x5a0b0b,
    emissive: 0xff1515,
    emissiveIntensity: 2.4,
  });
  const strobeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe8f4ff,
    emissiveIntensity: 2.8,
  });

  // ---- 1. Pürüzsüz Çok İstasyonlu (Lofted) Gövde + 3B Conformal Camlar ve Şeritler ----
  const fus = new THREE.Mesh(buildLoftedFuselageGeo(), white);
  body.add(fus);

  // Burun üstü mat koyu gri yansıma önleyici (anti-glare) panel
  const antiGlarePatch = new THREE.Mesh(
    buildFuselageAngularPatch(-2.52, -1.66, () => -0.55, () => 0.55, 0.0035, 12, 16),
    antiGlareMat,
  );
  body.add(antiGlarePatch);

  // 3B Conformal Ön Cam (Windshield: z = -1.64 .. -1.13, kabin eğimine birebir oturur)
  const windshieldPatch = new THREE.Mesh(
    buildFuselageAngularPatch(
      -1.64,
      -1.13,
      (tz) => -0.94 - tz * 0.12,
      (tz) => 0.94 + tz * 0.12,
      0.004,
      14,
      24,
    ),
    glassMat,
  );
  // Ön cam orta direği (Center post)
  const windshieldPost = new THREE.Mesh(
    buildFuselageAngularPatch(-1.64, -1.13, () => -0.038, () => 0.038, 0.006, 12, 4),
    white,
  );
  body.add(windshieldPatch, windshieldPost);

  // 3B Conformal Arka Panoramik Cam (Omni-Vision: z = 0.14 .. 0.52)
  const rearWindowPatch = new THREE.Mesh(
    buildFuselageAngularPatch(
      0.14,
      0.52,
      (tz) => -0.96 + tz * 0.15,
      (tz) => 0.96 - tz * 0.15,
      0.004,
      12,
      20,
    ),
    glassMat,
  );
  body.add(rearWindowPatch);

  // Sağ ve sol gövde yan pencereleri, 3 renkli Cessna Skyhawk şerit kuşağı ve TC-TSI tescil yazısı
  for (const side of [-1, 1] as (-1 | 1)[]) {
    // Ön kapı yan camı (Pilot / Copilot: z = -1.06 .. -0.42)
    const frontSideWin = new THREE.Mesh(
      buildFuselageSideRibbon(
        side,
        -1.06,
        -0.42,
        () => 0.25,
        (z) => 0.55 + (z + 1.06) * 0.02,
        0.004,
        14,
        8,
      ),
      glassMat,
    );
    // Arka yolcu yan camı (z = -0.32 .. 0.08)
    const rearSideWin = new THREE.Mesh(
      buildFuselageSideRibbon(
        side,
        -0.32,
        0.08,
        () => 0.25,
        (z) => 0.54 - (z + 0.32) * 0.08,
        0.004,
        12,
        8,
      ),
      glassMat,
    );
    body.add(frontSideWin, rearSideWin);

    // Kırmızı ana gövde şeridi (Burundan kuyruğa yükselen keskin 3B kuşak)
    const yCenter = (z: number) => {
      const u = clamp((z - -2.44) / (2.5 - -2.44), 0, 1);
      return -0.02 + u * 0.14 + Math.sin(u * Math.PI) * -0.025;
    };
    const halfBand = (z: number) => {
      const u = clamp((z - -2.44) / (2.5 - -2.44), 0, 1);
      return 0.038 * (1 - u * 0.32);
    };

    const redRibbon = new THREE.Mesh(
      buildFuselageSideRibbon(
        side,
        -2.42,
        2.5,
        (z) => yCenter(z) - halfBand(z),
        (z) => yCenter(z) + halfBand(z),
        0.004,
        36,
        6,
      ),
      redDecal,
    );
    const navyRibbon = new THREE.Mesh(
      buildFuselageSideRibbon(
        side,
        -2.36,
        2.48,
        (z) => yCenter(z) - halfBand(z) * 1.95,
        (z) => yCenter(z) - halfBand(z) * 1.18,
        0.004,
        36,
        4,
      ),
      navyDecal,
    );
    const goldRibbon = new THREE.Mesh(
      buildFuselageSideRibbon(
        side,
        -2.39,
        2.48,
        (z) => yCenter(z) + halfBand(z) * 1.2,
        (z) => yCenter(z) + halfBand(z) * 1.62,
        0.004,
        36,
        4,
      ),
      goldDecal,
    );
    // Kuyruk konisi üzerinde sıfır bozulmalı TC-TSI tescil plakası (z = 0.62 .. 1.38)
    const regPatch = new THREE.Mesh(
      buildFuselageSideRibbon(
        side,
        0.62,
        1.38,
        (z) => yCenter(z) + halfBand(z) * 1.85,
        (z) => yCenter(z) + halfBand(z) * 1.85 + 0.115,
        0.005,
        14,
        6,
      ),
      regMat,
    );
    body.add(redRibbon, navyRibbon, goldRibbon, regPatch);
  }

  // ---- 2. Motor Kaportası (Cowling) Hava Girişleri, Kısa Egzoz Çıkışları, Spinner ve Pervane ----
  for (const s of [-1, 1]) {
    // Kaporta içine gömülü motor soğutma hava girişi (dışarı taşan kutu yok)
    const inletHole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.06, 14).rotateX(Math.PI / 2),
      dark,
    );
    inletHole.scale.set(1.35, 0.85, 1);
    inletHole.position.set(s * 0.14, -0.01, -2.54);
    body.add(inletHole);

    // Kaporta altında zarif, kısa egzoz ucu
    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10).rotateX(Math.PI * 0.25),
      silver,
    );
    exhaust.position.set(s * 0.11, -0.37, -1.82);
    body.add(exhaust);
  }

  // Parlak gümüş/beyaz parabolik pervane konisi (Spinner: z = -2.98 .. -2.54)
  const spinnerPts = [
    [0.004, 0.0],
    [0.065, 0.08],
    [0.125, 0.19],
    [0.165, 0.32],
    [0.185, 0.44],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const spinnerGeo = new THREE.LatheGeometry(spinnerPts, 28);
  spinnerGeo.rotateX(Math.PI / 2);
  const spinner = new THREE.Mesh(spinnerGeo, silver);
  spinner.position.set(0, -0.02, -2.98);
  body.add(spinner);

  // Bükümlü 2 palli pervane (tam spinner ortasından z = -2.68'den çıkar)
  const prop = new THREE.Group();
  prop.position.set(0, -0.02, -2.68);
  for (const s of [1, -1]) {
    const bladeGroup = new THREE.Group();
    bladeGroup.rotation.z = s === 1 ? 0 : Math.PI;

    const bladeGeo = new THREE.CylinderGeometry(0.048, 0.072, 1.18, 16);
    bladeGeo.scale(1.35, 1, 0.22);
    const blade = new THREE.Mesh(bladeGeo, dark);
    blade.position.y = 0.68;
    blade.rotation.y = 0.22;
    bladeGroup.add(blade);

    const tipGeo = new THREE.CylinderGeometry(0.036, 0.048, 0.15, 16);
    tipGeo.scale(1.35, 1, 0.22);
    const tip = new THREE.Mesh(tipGeo, yellow);
    tip.position.y = 1.33;
    tip.rotation.y = 0.16;
    bladeGroup.add(tip);

    prop.add(bladeGroup);
  }
  body.add(prop);

  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.42, 32),
    new THREE.MeshBasicMaterial({
      map: propBlurTexture(),
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  propDisc.position.set(0, -0.02, -2.67);
  body.add(propDisc);

  // ---- 3. Yüksek Kanat (Sıfır Boşluklu Birleşik NACA 2412 Airfoil: Kanat + Flap + Aileron + Wingtip) ----
  const wingRootY = 0.61;
  const wingY = (x: number) => wingRootY + Math.abs(x) * TAN_D;
  // Arka lonjeron (menteşe) hattı tüm açıklık boyunca z = -0.26'da tamamen düzdür:
  // İç kanat (|x| = 0 .. 1.88): zLE = -1.1776, chord = 1.24 -> zLE + 0.74 * chord = -0.26
  // Dış kanat ucu (|x| = 3.86): zLE = -0.9704, chord = 0.96 -> zLE + 0.74 * chord = -0.26
  const WING_HINGE_Z = -0.26;
  const zLeIn = -1.1776;
  const cIn = 1.24;
  const zLeOut = -0.9704;
  const cOut = 0.96;

  // Kabin üstü merkez kanat birleşimi (x = -0.42 .. +0.42, tam veter s = 0 .. 1.0)
  const centerSection = new THREE.Mesh(
    buildHorizontalAirfoilSegment(-0.42, 0.42, zLeIn, cIn, 0.13, zLeIn, cIn, 0.13, 0.02, 0.0, 1.0),
    white,
  );
  centerSection.position.set(0, wingRootY, 0);
  body.add(centerSection);

  const buildWingHalf = (s: 1 | -1) => {
    const g = new THREE.Group();
    g.position.set(0, wingRootY, 0);
    g.rotation.z = s * DIHEDRAL * DEG;

    // 1. İç kanat ana gövdesi (|x| = 0.40 .. 1.88, s = 0.0 .. 0.74)
    const innerWing = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        s * 0.4,
        s * 1.88,
        zLeIn,
        cIn,
        0.13,
        zLeIn,
        cIn,
        0.125,
        0.02,
        0.0,
        0.74,
      ),
      white,
    );

    // 2. Dış kanat ana gövdesi (|x| = 1.88 .. 3.86, s = 0.0 .. 0.74, konik daralma)
    const outerWing = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        s * 1.88,
        s * 3.86,
        zLeIn,
        cIn,
        0.125,
        zLeOut,
        cOut,
        0.112,
        0.02,
        0.0,
        0.74,
      ),
      white,
    );
    g.add(innerWing, outerWing);

    // 3. Flap (|x| = 0.42 .. 1.86, s = 0.74 .. 1.0, aynı NACA 2412 kesitinin devamı -> sıfır boşluk!)
    const flapPivot = new THREE.Group();
    flapPivot.position.set(0, 0, WING_HINGE_Z);
    const flapMesh = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        s * 0.42,
        s * 1.86,
        zLeIn,
        cIn,
        0.13,
        zLeIn,
        cIn,
        0.125,
        0.02,
        0.74,
        1.0,
        0,
        WING_HINGE_Z,
      ),
      white,
    );
    flapPivot.add(flapMesh);
    g.add(flapPivot);

    // 4. Aileron (|x| = 1.88 .. 3.85, s = 0.74 .. 1.0, aynı konik NACA 2412 kesitinin devamı -> sıfır boşluk!)
    const aileronPivot = new THREE.Group();
    aileronPivot.position.set(0, 0, WING_HINGE_Z);
    const aileronMesh = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        s * 1.88,
        s * 3.85,
        zLeIn,
        cIn,
        0.125,
        zLeOut,
        cOut,
        0.112,
        0.02,
        0.74,
        1.0,
        0,
        WING_HINGE_Z,
      ),
      white,
    );
    aileronPivot.add(aileronMesh);
    g.add(aileronPivot);

    // 5. Kırmızı Hoerner Kanat Ucu Karenajı (|x| = 3.86 .. 4.10, tam veter s = 0.0 .. 1.0, hem kanat hem aileron ucuyla tam hizalı)
    const tipCap = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        s * 3.86,
        s * 4.1,
        zLeOut,
        cOut,
        0.112,
        -0.84,
        0.64,
        0.042,
        0.01,
        0.0,
        1.0,
      ),
      red,
    );
    g.add(tipCap);

    // Kanat ucu seyrüsefer lambası (sol kırmızı, sağ yeşil) ve beyaz çakar (strobe) lambası
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), s < 0 ? navRed : navGreen);
    nav.position.set(s * 4.08, 0.0, -0.76);
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), strobeMat);
    strobe.position.set(s * 4.09, 0.0, -0.58);
    g.add(nav, strobe);

    return { group: g, aileron: aileronPivot, flap: flapPivot, strobe };
  };

  const wingR = buildWingHalf(1);
  const wingL = buildWingHalf(-1);
  body.add(wingR.group, wingL.group);

  // Aerodinamik damla kesitli kanat destek dikmeleri (Wing Lift Struts: gövde ve kanat içine temizce gömülür)
  for (const s of [-1, 1]) {
    const pLow = new THREE.Vector3(s * 0.36, -0.28, -0.62);
    const pHigh = new THREE.Vector3(s * 2.15, wingY(2.15) + 0.02, -0.66);
    body.add(strut(pLow, pHigh, 0.026, white, 2.3));
  }

  // ---- 4. Üç Tekerlekli İniş Takımı ve Conformal Şeritli Tekerlek Karenajları (Wheel Pants) ----
  for (const s of [-1, 1]) {
    const legTop = new THREE.Vector3(s * 0.35, -0.3, -0.34);
    const legBot = new THREE.Vector3(s * 1.02, -1.02, -0.28);
    body.add(strut(legTop, legBot, 0.032, white, 1.85));

    const mainPant = buildWheelPantGroup(1.0, white, redDecal, tyre, silver);
    mainPant.position.set(s * 1.04, -1.04, -0.28);
    body.add(mainPant);
  }

  // Ön dikme (Nose Gear): üst beyaz manşon + parlak gümüş oleo amortisör + yönlendirilebilir tekerlek
  body.add(
    strut(new THREE.Vector3(0, -0.28, -1.96), new THREE.Vector3(0, -0.68, -1.99), 0.042, white, 1.5),
    strut(new THREE.Vector3(0, -0.65, -1.99), new THREE.Vector3(0, -1.0, -2.02), 0.03, silver),
  );

  const noseGearPivot = new THREE.Group();
  noseGearPivot.position.set(0, -1.04, -2.02);
  const nosePant = buildWheelPantGroup(0.84, white, redDecal, tyre, silver);
  noseGearPivot.add(nosePant);
  body.add(noseGearPivot);

  // ---- 5. Kuyruk Takımı (Sıfır Boşluklu Birleşik NACA 0009 Yatay Stabilize + Elevatör ve Dikey Fin + Rudder) ----
  const HSTAB_HINGE_Z = 2.466;
  const hsLeRoot = 1.92;
  const hsLeTip = 2.08;
  const hsChordTip = (HSTAB_HINGE_Z - hsLeTip) / 0.68;

  for (const s of [-1, 1] as (-1 | 1)[]) {
    const hstabHalf = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        0,
        s * 1.46,
        hsLeRoot,
        (HSTAB_HINGE_Z - hsLeRoot) / 0.68,
        0.105,
        hsLeTip,
        hsChordTip,
        0.095,
        0,
        0.0,
        0.68,
      ),
      white,
    );
    hstabHalf.position.set(0, 0.12, 0);
    body.add(hstabHalf);
  }

  // Hareketli Elevatör (|x| = 0.04 .. 1.46, s = 0.68 .. 1.0, aynı NACA 0009 profilin devamı -> sıfır boşluk!)
  const elevatorPivot = new THREE.Group();
  elevatorPivot.position.set(0, 0.12, HSTAB_HINGE_Z);
  for (const s of [-1, 1] as (-1 | 1)[]) {
    const elevHalf = new THREE.Mesh(
      buildHorizontalAirfoilSegment(
        s * 0.04,
        s * 1.46,
        hsLeRoot,
        (HSTAB_HINGE_Z - hsLeRoot) / 0.68,
        0.105,
        hsLeTip,
        hsChordTip,
        0.095,
        0,
        0.68,
        1.0,
        0,
        HSTAB_HINGE_Z,
      ),
      white,
    );
    elevatorPivot.add(elevHalf);
  }
  body.add(elevatorPivot);

  // Dikey Stabilize (Fin) ve Rudder:
  const FIN_HINGE_Z = 2.52;
  const finY0 = 0.11;
  const finY1 = 1.34;
  const finZLe = (y: number) => {
    const t = clamp((y - finY0) / (finY1 - finY0), 0, 1);
    return 1.48 + t * 0.56;
  };
  const finTotalChord = (y: number) => {
    const zLe = finZLe(y);
    return (FIN_HINGE_Z - zLe) / 0.68;
  };
  const finThick = (y: number) => {
    const t = clamp((y - finY0) / (finY1 - finY0), 0, 1);
    return 0.105 - t * 0.015;
  };

  // Ana Dikey Stabilize (s = 0.0 .. 0.68, y = 0.11 .. 1.34)
  const finMain = new THREE.Mesh(
    buildVerticalAirfoilSegment(
      finY0,
      finY1,
      finZLe(finY0),
      finTotalChord(finY0),
      finThick(finY0),
      finZLe(finY1),
      finTotalChord(finY1),
      finThick(finY1),
      0.0,
      0.68,
    ),
    white,
  );
  body.add(finMain);

  // Zarif Dorsal Fin (kuyruk konisi sırtından ana fin hücum kenarına pürüzsüz NACA geçişi)
  const dorsalFin = new THREE.Mesh(
    buildVerticalAirfoilSegment(
      0.19,
      0.46,
      1.06,
      1.46,
      0.042,
      finZLe(0.46),
      FIN_HINGE_Z - finZLe(0.46),
      0.072,
      0.0,
      1.0,
    ),
    white,
  );
  body.add(dorsalFin);

  // Dikey Stabilize üzerindeki kapaksız (skin-only) conformal NACA 0009 şerit kuşakları (sıfır 3B şişkinlik!)
  const addFinStripe = (ya0: number, ya1: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(
      buildVerticalAirfoilSegment(
        ya0,
        ya1,
        finZLe(ya0),
        finTotalChord(ya0),
        finThick(ya0),
        finZLe(ya1),
        finTotalChord(ya1),
        finThick(ya1),
        0.03,
        0.678,
        0,
        0,
        0.0018,
        false,
      ),
      mat,
    );
    body.add(m);
  };
  addFinStripe(0.46, 0.56, navyDecal);
  addFinStripe(0.58, 0.88, redDecal);
  addFinStripe(0.9, 0.97, goldDecal);

  // Hareketli Rudder (y = 0.11 .. 1.34, s = 0.68 .. 1.0, aynı NACA 0009 profilin devamı -> sıfır boşluk!)
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, finY0, FIN_HINGE_Z);

  // Rudder ön beyaz gövdesi (s = 0.68 .. 0.86)
  const rudderWhite = new THREE.Mesh(
    buildVerticalAirfoilSegment(
      finY0,
      finY1,
      finZLe(finY0),
      finTotalChord(finY0),
      finThick(finY0),
      finZLe(finY1),
      finTotalChord(finY1),
      finThick(finY1),
      0.68,
      0.86,
      finY0,
      FIN_HINGE_Z,
    ),
    white,
  );
  // Rudder üzerinde devam eden şerit kuşakları (Rudder döndüğünde şeritler de birlikte döner)
  const addRudderStripe = (ya0: number, ya1: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(
      buildVerticalAirfoilSegment(
        ya0,
        ya1,
        finZLe(ya0),
        finTotalChord(ya0),
        finThick(ya0),
        finZLe(ya1),
        finTotalChord(ya1),
        finThick(ya1),
        0.682,
        0.858,
        finY0,
        FIN_HINGE_Z,
        0.0018,
        false,
      ),
      mat,
    );
    rudderPivot.add(m);
  };
  addRudderStripe(0.46, 0.56, navyDecal);
  addRudderStripe(0.58, 0.88, redDecal);
  addRudderStripe(0.9, 0.97, goldDecal);

  // Rudder arka kırmızı firar kenarı (s = 0.86 .. 1.0, aynı airfoil kesiti -> sıfır çıkıntı!)
  const rudderRedTE = new THREE.Mesh(
    buildVerticalAirfoilSegment(
      finY0,
      finY1,
      finZLe(finY0),
      finTotalChord(finY0),
      finThick(finY0),
      finZLe(finY1),
      finTotalChord(finY1),
      finThick(finY1),
      0.86,
      1.0,
      finY0,
      FIN_HINGE_Z,
    ),
    red,
  );
  rudderPivot.add(rudderWhite, rudderRedTE);

  // Kuyruk beyaz seyrüsefer lambası (kuyruk konisi ucunda)
  const tailNav = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), navWhite);
  tailNav.position.set(0, 0.095, 2.84);
  body.add(tailNav);
  body.add(rudderPivot);

  // Kırmızı ikaz feneri (Fin tepesinde aerodinamik kırmızı kep üzerinde)
  const beaconCap = new THREE.Mesh(
    buildHorizontalAirfoilSegment(
      -0.025,
      0.025,
      finZLe(finY1),
      finTotalChord(finY1),
      0.08,
      finZLe(finY1),
      finTotalChord(finY1),
      0.08,
      0,
      0.0,
      0.98,
    ),
    red,
  );
  beaconCap.position.set(0, finY1, 0);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), beaconMat);
  beacon.position.set(0, finY1 + 0.035, 2.32);
  body.add(beaconCap, beacon);

  return {
    group,
    body,
    prop,
    propDisc,
    aileronL: wingL.aileron,
    aileronR: wingR.aileron,
    elevator: elevatorPivot,
    rudder: rudderPivot,
    noseGear: noseGearPivot,
    flapL: wingL.flap,
    flapR: wingR.flap,
    beacon,
    strobeL: wingL.strobe,
    strobeR: wingR.strobe,
  };
}

export class AircraftView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
  readonly controls: OrbitControls;
  camMode: CamMode = 'chase';

  private plane: THREE.Group;
  private body: THREE.Group;
  private prop: THREE.Group;
  private propDisc: THREE.Mesh;
  private aileronL: THREE.Object3D;
  private aileronR: THREE.Object3D;
  private elevator: THREE.Object3D;
  private rudder: THREE.Object3D;
  private noseGear: THREE.Object3D;
  private flapL: THREE.Object3D;
  private flapR: THREE.Object3D;
  private beacon: THREE.Mesh;
  private strobeL: THREE.Mesh;
  private strobeR: THREE.Mesh;
  private flapPos = 0;
  /** Pilot girdisini izleyen görsel yüzey durumları (realDt ile; duraklıyken de oynar). */
  private visRudder = 0;
  private visElev = 0;
  private clockT = 0;
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private waterMat: THREE.ShaderMaterial;
  private terrainChunks: THREE.Mesh[] = [];
  private waterChunks: THREE.Mesh[] = [];
  private clouds: THREE.Group[] = [];
  private veg: Veg[] = [];
  private bushes: SceneryItem[] = [];
  private grasses: SceneryItem[] = [];
  private rocks: SceneryItem[] = [];
  private houses: House[] = [];
  private pines: THREE.InstancedMesh;
  private leaves: THREE.InstancedMesh;
  private bushMesh: THREE.InstancedMesh;
  private grassMesh: THREE.InstancedMesh;
  private rockMesh: THREE.InstancedMesh;
  private houseMesh: THREE.InstancedMesh;
  private landmarks: THREE.Group;
  private windsock: THREE.Group;
  private towerBeacon: THREE.Mesh;
  private boats: THREE.Group[] = [];
  private windmillBlades: THREE.Group;
  private landmarkX = 0;
  private landmarkZ = 0;
  private dummy = new THREE.Object3D();
  private trackArrow: THREE.ArrowHelper;
  private trailGeo: THREE.BufferGeometry;
  private trailPos: Float32Array;
  private trailCount = 0;
  private trailTimer = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private orbitPrev = new THREE.Vector3();
  private orbitInit = false;

  constructor(canvas: HTMLElement) {
    const s = this.scene;
    s.background = new THREE.Color(SKY_HORIZON);
    s.fog = new THREE.FogExp2(SKY_HORIZON, 0.00048);

    // Yörünge kamerası: hedef hep uçak (pan yok), kullanıcı açı + zoom verir
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 80;
    this.controls.minPolarAngle = (5 * Math.PI) / 180;
    this.controls.maxPolarAngle = (95 * Math.PI) / 180;
    this.controls.enabled = false;

    s.add(new THREE.HemisphereLight(0xf2f8ff, 0x548a3f, 1.32));
    this.sun = new THREE.DirectionalLight(0xfff8ea, 1.72);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 450;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.1;
    s.add(this.sun);
    s.add(this.sun.target);

    // Gökyüzü kubbesi (Rayleigh + Mie + Cirrus shader) + 360° ufuk sıradağları
    const sunDir = new THREE.Vector3(70, 130, 45).normalize();
    this.skyMat = skyMaterial(sunDir);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1650, 32, 24), this.skyMat);
    this.sky.frustumCulled = false;
    s.add(this.sky);

    // Dış yüksek Alp sıradağları + iç yeşil dağ etekleri (piksel bazlı kaya & kar oluğu shader'ı ile)
    const mtnMat = createMountainMaterial(sunDir);
    const outerMtns = new THREE.Mesh(buildMountainRingGeo(1120, 1340, 1560, 185, 92, 0.0), mtnMat);
    const innerHills = new THREE.Mesh(buildMountainRingGeo(920, 1100, 1280, 95, 115, 2.1), mtnMat);
    outerMtns.frustumCulled = false;
    innerHills.frustumCulled = false;
    this.sky.add(outerMtns, innerHills);

    // Gerçek 3B Oyulmuş Arazi (Tepeler, Vadiler, Nehir Kanyonu) + Gerçek 3B Dalgalı Su Yüzeyi (3x3 kesintisiz dilim)
    const terrainGeo = buildSculptedTerrainGeo();
    const terrainMat = createTerrainMaterial(sunDir);
    const waterGeo = buildWaterMeshGeo();
    this.waterMat = createWaterMaterial(sunDir);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tChunk = new THREE.Mesh(terrainGeo, terrainMat);
        tChunk.position.set(dx * SCENERY_SIZE, 0, dz * SCENERY_SIZE);
        tChunk.frustumCulled = false;
        s.add(tChunk);
        this.terrainChunks.push(tChunk);

        const wChunk = new THREE.Mesh(waterGeo, this.waterMat);
        wChunk.position.set(dx * SCENERY_SIZE, 0, dz * SCENERY_SIZE);
        wChunk.frustumCulled = false;
        s.add(wChunk);
        this.waterChunks.push(wChunk);
      }
    }

    // 3B Havaalanı Platosu, 3B Taş Kemer Köprü, Göl Marinası, Yel Değirmeni ve 12 Tekne
    const lm = buildWorldLandmarks();
    this.landmarks = lm.group;
    this.windsock = lm.windsock;
    this.towerBeacon = lm.beacon;
    this.boats = lm.boats;
    this.windmillBlades = lm.windmillBlades;
    s.add(this.landmarks);

    // 3B Ağaçlar: 4 katmanlı ladin/çam + 6 kubbeli meşe/çınar (gerçek 3B arazi yüksekliğine oturur)
    this.veg = scatterVegetation();
    const pineGeo = buildPineTreeGeo();
    const leafGeo = buildLeafTreeGeo();
    const pineCount = this.veg.filter((v) => v.kind === 0).length;
    const leafCount = this.veg.length - pineCount;
    const vtxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.pines = new THREE.InstancedMesh(pineGeo, vtxMat, pineCount);
    this.leaves = new THREE.InstancedMesh(leafGeo, vtxMat, leafCount);
    this.pines.castShadow = true;
    this.leaves.castShadow = true;
    this.pines.frustumCulled = false;
    this.leaves.frustumCulled = false;

    const cInst = new THREE.Color();
    let piInit = 0;
    let liInit = 0;
    for (const v of this.veg) {
      cInst.setHex(v.tint);
      if (v.kind === 0) this.pines.setColorAt(piInit++, cInst);
      else this.leaves.setColorAt(liInit++, cInst);
    }
    if (this.pines.instanceColor) this.pines.instanceColor.needsUpdate = true;
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
    s.add(this.pines, this.leaves);

    // 3B Çalılar, 3B Ot/Çimen/Sazlık Demetleri ve 3B Nehir/Yamaç Kayaları
    const groundFol = scatterGroundFoliage();
    this.bushes = groundFol.bushes;
    this.grasses = groundFol.grasses;
    this.rocks = groundFol.rocks;

    this.bushMesh = new THREE.InstancedMesh(buildBushGeo(), vtxMat, this.bushes.length);
    this.grassMesh = new THREE.InstancedMesh(buildGrassTuftGeo(), vtxMat, this.grasses.length);
    this.rockMesh = new THREE.InstancedMesh(buildRockGeo(), vtxMat, this.rocks.length);
    this.bushMesh.castShadow = true;
    this.bushMesh.frustumCulled = false;
    this.grassMesh.frustumCulled = false;
    this.rockMesh.frustumCulled = false;

    this.bushes.forEach((b, i) => {
      cInst.setHex(b.tint);
      this.bushMesh.setColorAt(i, cInst);
    });
    this.grasses.forEach((g, i) => {
      cInst.setHex(g.tint);
      this.grassMesh.setColorAt(i, cInst);
    });
    this.rocks.forEach((r, i) => {
      cInst.setHex(r.tint);
      this.rockMesh.setColorAt(i, cInst);
    });
    if (this.bushMesh.instanceColor) this.bushMesh.instanceColor.needsUpdate = true;
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
    if (this.rockMesh.instanceColor) this.rockMesh.instanceColor.needsUpdate = true;
    s.add(this.bushMesh, this.grassMesh, this.rockMesh);

    // 3B Köy Evleri ve Dağ Evleri (verandalı, taş subasmanlı, bacalı ve pencereli)
    this.houses = scatterHouses();
    const houseGeo = buildCountryHouseGeo();
    this.houseMesh = new THREE.InstancedMesh(houseGeo, vtxMat, this.houses.length);
    this.houseMesh.castShadow = true;
    this.houseMesh.frustumCulled = false;
    this.houses.forEach((h, idx) => {
      cInst.setHex(h.tint);
      this.houseMesh.setColorAt(idx, cInst);
    });
    if (this.houseMesh.instanceColor) this.houseMesh.instanceColor.needsUpdate = true;
    s.add(this.houseMesh);

    // Hacimli kümülüs (Cumulus) bulutları: düz tabanlı, üstü güneşle aydınlanan pürüzsüz kubbeler
    const puffGeo = new THREE.SphereGeometry(1, 16, 12);
    const puffTopMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x323d4d,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.95,
    });
    const puffBaseMat = new THREE.MeshLambertMaterial({
      color: 0xdce6f2,
      emissive: 0x253040,
      emissiveIntensity: 0.28,
      transparent: true,
      opacity: 0.9,
    });
    let cseed = 99;
    const crnd = () => ((cseed = (cseed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      const n = 6 + ((crnd() * 5) | 0);
      for (let j = 0; j < n; j++) {
        const isTopDome = j >= n - 2;
        const p = new THREE.Mesh(puffGeo, isTopDome ? puffTopMat : puffBaseMat);
        const rx = (crnd() - 0.5) * 9.5;
        const rz = (crnd() - 0.5) * 5.2;
        const ry = isTopDome ? 0.9 + crnd() * 1.1 : (crnd() - 0.3) * 0.6;
        p.position.set(rx, ry, rz);
        const sx = 2.4 + crnd() * 2.8;
        const sy = isTopDome ? 1.4 + crnd() * 1.1 : 1.0 + crnd() * 0.7;
        const sz = 2.0 + crnd() * 2.0;
        p.scale.set(sx, sy, sz);
        g.add(p);
      }
      g.position.set(
        (crnd() - 0.5) * SCENERY_SIZE,
        34 + crnd() * 38,
        (crnd() - 0.5) * SCENERY_SIZE,
      );
      g.scale.setScalar(1.35 + crnd() * 1.65);
      s.add(g);
      this.clouds.push(g);
    }

    const ac = buildAircraft();
    this.plane = ac.group;
    this.body = ac.body;
    this.prop = ac.prop;
    this.propDisc = ac.propDisc;
    this.aileronL = ac.aileronL;
    this.aileronR = ac.aileronR;
    this.elevator = ac.elevator;
    this.rudder = ac.rudder;
    this.noseGear = ac.noseGear;
    this.flapL = ac.flapL;
    this.flapR = ac.flapR;
    this.beacon = ac.beacon;
    this.strobeL = ac.strobeL;
    this.strobeR = ac.strobeR;
    this.plane.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== this.propDisc) o.castShadow = true;
    });
    s.add(this.plane);

    // Uçuş yolu yönü (sarı ok): slip/skid'de burun bu oktan sapar
    this.trackArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
      7,
      0xffd400,
      1.2,
      0.6,
    );
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
    this.controls.enabled = mode === 'orbit';
    this.orbitInit = false;
  }

  resetTrail() {
    this.trailCount = 0;
    this.trailGeo.setDrawRange(0, 0);
  }

  /** 3B Arazi dilimlerini, ağaçları, çalıları, otları, kayaları ve evleri uçak etrafında sarar. */
  private updateScenery(px: number, pz: number) {
    const d = this.dummy;
    const wrap = (v: number, c: number) => {
      let r = v - c;
      if (r > SCENERY_HALF) r -= SCENERY_SIZE;
      else if (r < -SCENERY_HALF) r += SCENERY_SIZE;
      return c + r;
    };

    // 3x3 3B Arazi ve 3B Su dilimlerini uçağın bulunduğu hücreye kilitle
    const cellX = Math.round(px / SCENERY_SIZE) * SCENERY_SIZE;
    const cellZ = Math.round(pz / SCENERY_SIZE) * SCENERY_SIZE;
    let ci = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = cellX + dx * SCENERY_SIZE;
        const cz = cellZ + dz * SCENERY_SIZE;
        this.terrainChunks[ci].position.set(cx, 0, cz);
        this.waterChunks[ci].position.set(cx, 0, cz);
        ci++;
      }
    }

    this.landmarkX = wrap(this.landmarkX, px);
    this.landmarkZ = wrap(this.landmarkZ, pz);
    this.landmarks.position.set(this.landmarkX, 0, this.landmarkZ);

    let pi = 0;
    let li = 0;
    for (const t of this.veg) {
      t.x = wrap(t.x, px);
      t.z = wrap(t.z, pz);
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.rot, 0);
      d.scale.setScalar(t.s);
      d.updateMatrix();
      if (t.kind === 0) {
        this.pines.setMatrixAt(pi++, d.matrix);
      } else {
        this.leaves.setMatrixAt(li++, d.matrix);
      }
    }
    this.pines.instanceMatrix.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.bushes.length; i++) {
      const b = this.bushes[i];
      b.x = wrap(b.x, px);
      b.z = wrap(b.z, pz);
      d.position.set(b.x, b.y, b.z);
      d.rotation.set(0, b.rot, 0);
      d.scale.setScalar(b.s);
      d.updateMatrix();
      this.bushMesh.setMatrixAt(i, d.matrix);
    }
    this.bushMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.grasses.length; i++) {
      const g = this.grasses[i];
      g.x = wrap(g.x, px);
      g.z = wrap(g.z, pz);
      d.position.set(g.x, g.y, g.z);
      d.rotation.set(0, g.rot, 0);
      d.scale.setScalar(g.s);
      d.updateMatrix();
      this.grassMesh.setMatrixAt(i, d.matrix);
    }
    this.grassMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      r.x = wrap(r.x, px);
      r.z = wrap(r.z, pz);
      d.position.set(r.x, r.y, r.z);
      d.rotation.set(0, r.rot, 0);
      d.scale.setScalar(r.s);
      d.updateMatrix();
      this.rockMesh.setMatrixAt(i, d.matrix);
    }
    this.rockMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.houses.length; i++) {
      const h = this.houses[i];
      h.x = wrap(h.x, px);
      h.z = wrap(h.z, pz);
      d.position.set(h.x, h.y, h.z);
      d.rotation.set(0, h.rot, 0);
      d.scale.setScalar(h.s);
      d.updateMatrix();
      this.houseMesh.setMatrixAt(i, d.matrix);
    }
    this.houseMesh.instanceMatrix.needsUpdate = true;
  }

  /** Bulutlar rüzgarla sürüklenir ve uçak etrafında sarılır. */
  private updateClouds(px: number, pz: number, dt: number) {
    for (const g of this.clouds) {
      g.position.x += WIND_DRIFT * dt;
      if (g.position.x - px > SCENERY_HALF) g.position.x -= SCENERY_SIZE;
      else if (g.position.x - px < -SCENERY_HALF) g.position.x += SCENERY_SIZE;
      if (g.position.z - pz > SCENERY_HALF) g.position.z -= SCENERY_SIZE;
      else if (g.position.z - pz < -SCENERY_HALF) g.position.z += SCENERY_SIZE;
    }
  }

  update(m: FlightModel, simDt: number, realDt: number) {
    const px = m.x * WORLD_SCALE;
    const pz = m.z * WORLD_SCALE;
    const pos = new THREE.Vector3(px, ALT, pz);

    // ---- Pilot girdisi izleme (gerçek zamanlı; sim duraklıyken de çalışır) ----
    const kFast = 1 - Math.exp(-Math.max(realDt, 1e-4) * 8);
    this.visRudder += (m.target.rudder - this.visRudder) * kFast;
    this.plane.position.copy(pos);
    this.plane.rotation.y = -(m.heading + this.visRudder * SIDESLIP_PER_RUDDER * DEG);

    // ---- Kontrol yüzeyleri ----
    const ailCmd = clamp((m.target.bank - m.bank) / 8 + m.rollRate / 12, -1, 1);
    const ail = ailCmd * AILERON_MAX * DEG;
    this.aileronR.rotation.x = -ail;
    this.aileronL.rotation.x = ail;

    const nT = 1 / Math.max(Math.cos(m.target.bank * DEG), 0.2);
    const backTarget = clamp((nT - 1) * 45, 0, ELEVATOR_MAX);
    this.visElev += (backTarget - this.visElev) * (1 - Math.exp(-Math.max(realDt, 1e-4) * 5));
    this.elevator.rotation.x = -this.visElev * DEG;
    const n = 1 / Math.max(Math.cos(m.bank * DEG), 0.2);
    const back = clamp((n - 1) * 45, 0, ELEVATOR_MAX);
    this.body.rotation.x = back * 0.45 * DEG;

    this.rudder.rotation.y = this.visRudder * RUDDER_MAX * DEG;
    this.noseGear.rotation.y = -this.visRudder * 12 * DEG;

    const flapTarget = clamp((FLAP_UP_KT - m.speed) / (FLAP_UP_KT - FLAP_FULL_KT), 0, 1) * FLAP_MAX;
    this.flapPos += (flapTarget - this.flapPos) * (1 - Math.exp(-realDt * 2.5));
    this.flapL.rotation.x = this.flapPos * DEG;
    this.flapR.rotation.x = this.flapPos * DEG;

    this.body.rotation.z = -m.bank * DEG;

    // Pervane + ikaz lambaları + gökyüzü sirüs akışı + 3B nehir dalgası + rüzgar tulumu + yel değirmeni + tekneler
    this.prop.rotation.z += simDt * (30 + m.speed * 0.35);
    this.propDisc.visible = simDt > 0;
    this.clockT += realDt;
    this.skyMat.uniforms.uTime.value = this.clockT;
    this.waterMat.uniforms.uTime.value = this.clockT;
    this.windsock.rotation.y = Math.sin(this.clockT * 2.2) * 0.14;
    this.windsock.rotation.z = Math.cos(this.clockT * 3.1) * 0.06;
    this.towerBeacon.visible = (this.clockT % 2.0) < 0.35;
    this.windmillBlades.rotation.z -= realDt * 0.65;
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      b.position.y = WATER_Y + 0.06 + Math.sin(this.clockT * 2.1 + i * 1.3) * 0.035;
      b.rotation.z = Math.sin(this.clockT * 1.7 + i * 0.9) * 0.045;
      b.rotation.x = Math.cos(this.clockT * 1.4 + i * 1.1) * 0.025;
    }

    const beaconPhase = this.clockT % 1.4;
    this.beacon.visible = beaconPhase < 0.14;
    const strobePhase = (this.clockT + 0.5) % 1.4;
    const strobeOn = strobePhase < 0.06 || (strobePhase > 0.14 && strobePhase < 0.2);
    this.strobeL.visible = strobeOn;
    this.strobeR.visible = strobeOn;

    const dir = new THREE.Vector3(Math.sin(m.heading), 0, -Math.cos(m.heading));
    this.trackArrow.position.copy(pos);
    this.trackArrow.setDirection(dir);
    this.trackArrow.visible = this.camMode !== 'chase';

    // Gökyüzü + ufuk sıradağları + güneş uçağı izler
    this.sky.position.set(px, 0, pz);
    this.sun.position.set(px + 70, 130, pz + 45);
    this.sun.target.position.set(px, 0, pz);

    this.updateClouds(px, pz, realDt);
    this.updateScenery(px, pz);

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
    if (this.camMode === 'orbit') {
      if (!this.orbitInit) {
        this.orbitPrev.copy(pos);
        this.controls.target.copy(pos);
        this.orbitInit = true;
      } else {
        this.camera.position.add(pos.clone().sub(this.orbitPrev));
        this.controls.target.copy(pos);
        this.orbitPrev.copy(pos);
      }
      this.camera.up.set(0, 1, 0);
      this.controls.update();
      return;
    }
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
