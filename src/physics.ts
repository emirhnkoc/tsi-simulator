// Basit ama doğru uçuş / gösterge fiziği.
// İşaret kuralı: sağ yatış, sağ dönüş, sağ rudder ve sağa kayan top POZİTİF.

export const G = 9.81;
export const KT_TO_MS = 0.514444;
export const DEG = Math.PI / 180;
/** Standart dönüş (rate one): 3°/s, yani 360° 2 dakikada. */
export const STD_RATE = 3;
/** Tam rudder'ın koordineli dönüşe eklediği yaw hızı (°/s). */
export const RUDDER_RATE = 4;
/** Turn coordinator gyro'sunun eğim açısı. */
export const TC_CANT = 30;
/** Rudder'ın burunda oluşturduğu sideslip (yalnızca görsel), derece/tam rudder. */
export const SIDESLIP_PER_RUDDER = 10;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Verilen hızda standart dönüş için gereken yatış açısı (derece). */
export function stdBank(speedKt: number): number {
  const v = speedKt * KT_TO_MS;
  return Math.atan((v * STD_RATE * DEG) / G) / DEG;
}

export type CoordState = 'coordinated' | 'slip' | 'skid';

/** Senaryo betikleri her adımda çağrılır. false dönerse betik biter. */
export type Script = (m: FlightModel, dt: number) => boolean;

export class FlightModel {
  /** Pilotun / senaryonun istediği değerler. */
  target = { bank: 0, rudder: 0, speed: 100 };
  /** Maksimum roll hızı (°/s). */
  rollRateLimit = 15;
  script?: Script;

  // Uçak durumu
  bank = 0; // °
  rudder = 0; // -1..1
  speed = 100; // kt
  rollRate = 0; // °/s
  yawRate = 0; // °/s (gerçek dönüş hızı)
  coordRate = 0; // °/s (bu yatışta koordineli dönüş hızı)
  heading = 0; // rad, uçuş yolu (track) yönü
  x = 0; // m
  z = 0; // m (kuzey = -z)

  // Top (inklinometre)
  /** Görünür yerçekiminin uçak eksenine göre açısı (°). Pozitifse top sağa gider. */
  ballTarget = 0;
  ballPos = 0;
  ballVel = 0;
  lateralG = 0;

  // Gyro sinyalleri (°/s, sönümlü)
  tnsSignal = 0;
  tcSignal = 0;

  step(dt: number) {
    if (dt <= 0) return;
    if (this.script && !this.script(this, dt)) this.script = undefined;

    const t = this.target;
    this.rudder += (t.rudder - this.rudder) * (1 - Math.exp(-dt * 4));
    this.speed += (t.speed - this.speed) * (1 - Math.exp(-dt * 1.5));

    // Yatış: hız sınırlı, yumuşak roll
    const desired = clamp((t.bank - this.bank) * 2.0, -this.rollRateLimit, this.rollRateLimit);
    this.rollRate += (desired - this.rollRate) * (1 - Math.exp(-dt * 6));
    this.bank += this.rollRate * dt;

    // Dönüş hızı: ω = g·tanφ / V  (+ rudder etkisi)
    const v = Math.max(this.speed, 30) * KT_TO_MS;
    const phi = this.bank * DEG;
    const coord = (G * Math.tan(phi)) / v;
    const yaw = coord + RUDDER_RATE * DEG * this.rudder;
    this.coordRate = coord / DEG;
    this.yawRate = yaw / DEG;

    this.heading += yaw * dt;
    this.x += v * Math.sin(this.heading) * dt;
    this.z -= v * Math.cos(this.heading) * dt;

    // Topa etki eden kuvvetler (uçak ekseninde):
    // yerçekimi bileşeni iç tarafa, merkezkaç bileşeni dış tarafa iter.
    const n = v * yaw; // dönüş için gereken merkezcil ivme
    const side = G * Math.sin(phi) - n * Math.cos(phi);
    const down = G * Math.cos(phi) + n * Math.sin(phi);
    this.lateralG = side / G;
    this.ballTarget = clamp(Math.atan2(side, down) / DEG, -25, 25);

    // Sıvı içindeki top: sönümlü yay
    const wn = 7;
    const zeta = 0.55;
    const sub = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const acc = wn * wn * (this.ballTarget - this.ballPos) - 2 * zeta * wn * this.ballVel;
      this.ballVel += acc * h;
      this.ballPos += this.ballVel * h;
    }

    // Gyrolar
    const k = 1 - Math.exp(-dt / 0.25);
    // Turn & slip: yalnızca dikey eksen etrafındaki dönüş (yaw)
    this.tnsSignal += (this.yawRate - this.tnsSignal) * k;
    // Turn coordinator: 30° eğik gyro roll hızını da algılar
    const tcRaw = this.yawRate + this.rollRate * Math.tan(TC_CANT * DEG);
    this.tcSignal += (tcRaw - this.tcSignal) * k;
  }

  get sideslipDeg() {
    return this.rudder * SIDESLIP_PER_RUDDER;
  }

  get coordState(): CoordState {
    if (Math.abs(this.ballPos) < 1.5) return 'coordinated';
    const turnDir = Math.abs(this.yawRate) > 0.1 ? Math.sign(this.yawRate) : Math.sign(this.bank);
    if (turnDir === 0) return 'slip';
    // Top dönüşün içine kaydıysa slip, dışına kaydıysa skid
    return Math.sign(this.ballPos) === turnDir ? 'slip' : 'skid';
  }
}
