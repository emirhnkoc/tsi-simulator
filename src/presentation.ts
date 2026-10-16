import { CamMode } from './aircraftView';
import { CinematicShot, MechType } from './mechanismView';
import { FlightModel, stdBank } from './physics';

export interface PresStep {
  act: 'Uçuş' | 'Mekanizma';
  title: string;
  text: string;
  scenario?: string;
  customApply?: (m: FlightModel) => void;
  cam?: CamMode;
  view?: 'aircraft' | 'mechanism';
  mech?: MechType;
  slow?: boolean;
  shot?: CinematicShot;
}

/** Sağ ve sol dönüşler arasında yumuşak döngü yapan mekanizma demonstrasyon betiği. */
function turnCycleScript(period = 9): (m: FlightModel) => void {
  return (m: FlightModel) => {
    m.rollRateLimit = 14;
    m.target.rudder = 0;
    let t = 0;
    m.script = (mm, dt) => {
      t = (t + dt) % period;
      const phase = t / period;
      const sb = stdBank(mm.target.speed);
      if (phase < 0.38) {
        mm.target.bank = sb;
      } else if (phase < 0.5) {
        mm.target.bank = 0;
      } else if (phase < 0.88) {
        mm.target.bank = -sb;
      } else {
        mm.target.bank = 0;
      }
      return true;
    };
  };
}

/** Sınıf sunumu turu: 1. Perde Uçuş Fiziği (1-7), 2. Perde Sinematik Mekanizma Turu (8-13). */
export const PRES_STEPS: PresStep[] = [
  // ======================== 1. PERDE: UÇUŞ VE GÖSTERGELER ========================
  {
    act: 'Uçuş',
    title: '1 · İki Gösterge, İki Ayrı Cihaz',
    text: 'Üstteki Turn Coordinator, alttaki Turn-and-Slip göstergesi. İkisi de tek kasada birbirinden bağımsız iki cihaz barındırır: dönüş hızını ölçen cayro ibresi ve yan kaymayı ölçen sıvı dolu inklinometre (top).',
    scenario: 'level',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    act: 'Uçuş',
    title: '2 · Standart Dönüş (2 MIN = 3°/s)',
    text: "Saniyede 3° dönüş hızı (Rate One) ibreyi tam standart işaretine getirir. Bu hızla 360° tam tur 2 dakika sürer; kadrandaki '2 MIN' yazısı yatış açısını değil, bu dönüş süresini ifade eder.",
    scenario: 'stdR',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    act: 'Uçuş',
    title: '3 · Kritik Yanılgı: Yatış Açısı ≠ Dönüş Hızı',
    text: "Kadrandaki 'NO PITCH INFORMATION' uyarısına dikkat edin: Hız 75 kt'tan 165 kt'a çıkarken 3°/s dönüşü korumak için gereken yatış açısı 11°'den 23°'ye iki katına çıkar; fakat uçak silüeti aynı standart işarette sabit kalır!",
    cam: 'chase',
    view: 'aircraft',
    customApply: (m) => {
      m.rollRateLimit = 18;
      m.target.rudder = 0;
      let t = 0;
      m.script = (mm, dt) => {
        t += dt;
        // Hızı 75 kt ile 165 kt arasında yumuşakça değiştirirken standart dönüş yatışını koru
        const wave = Math.sin((t * Math.PI * 2) / 8);
        mm.target.speed = 120 + wave * 45;
        mm.target.bank = stdBank(mm.speed);
        return true;
      };
    },
  },
  {
    act: 'Uçuş',
    title: '4 · Koordineli Dönüş ve Kuvvet Dengesi',
    text: 'Top tam ortada: içeri çeken yerçekimi bileşeni ile dışarı savuran merkezkaç kuvveti birbirini dengeler. Üstten bakışta uçağın kaymadan kusursuz bir çember çizdiğini izleyin.',
    scenario: 'stdR',
    cam: 'top',
    view: 'aircraft',
  },
  {
    act: 'Uçuş',
    title: "5 · Slip (İçe Kayma) ve 'Step on the Ball'",
    text: "Yatış fazla, rudder yetersiz olduğunda yerçekimi baskın gelir ve top dönüşün içine (sağa) düşer. Düzeltmek için 'topun üzerine basılır' (top yönünde rudder verilir) ve top merkeze döner.",
    cam: 'chase',
    view: 'aircraft',
    customApply: (m) => {
      m.rollRateLimit = 15;
      m.target.speed = 100;
      let t = 0;
      m.script = (mm, dt) => {
        t = (t + dt) % 9.0;
        const sb = stdBank(mm.target.speed);
        if (t < 4.8) {
          // Önce belirgin slip göster (top sağda)
          mm.target.bank = sb + 10;
          mm.target.rudder = -0.55;
        } else {
          // Sonra 'step on the ball' ile rudder düzeltmesi uygula -> Koordineli!
          mm.target.bank = sb;
          mm.target.rudder = 0;
        }
        return true;
      };
    },
  },
  {
    act: 'Uçuş',
    title: '6 · Skid (Dışa Savrulma)',
    text: 'Yatışa göre fazla rudder verildiğinde merkezkaç kuvveti ağır basar ve top dönüşün dışına (sola) savrulur. Özellikle alçak irtifa dönüşlerinde iç kanadın stall olmasına yol açabileceği için çok tehlikelidir.',
    scenario: 'skid',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    act: 'Uçuş',
    title: '7 · Roll Girişinde İki Göstergenin Farkı',
    text: "Yavaş çekimde izleyin: Uçak yatışa (roll) başlar başlamaz Turn Coordinator'ın 30° eğik cayrosu roll hızını algılayıp hemen sapar. Turn-and-Slip ise yalnızca burun dönmeye (yaw) başladığında geriden yetişir.",
    scenario: 'roll',
    cam: 'chase',
    view: 'aircraft',
    slow: true,
  },

  // ======================== 2. PERDE: SİNEMATİK MEKANİZMA TURU ========================
  {
    act: 'Mekanizma',
    title: '8 · İnklinometre: Sıvı Dolu Cam Tüp ve Bilye',
    text: 'Kadranın altındaki kavisli cam tüp cayrodan tamamen bağımsızdır. İçindeki sönümleme sıvısı titreşimi süzerken, siyah akik/çelik bilye yalnızca yerçekimi ve merkezkaç kuvvetlerinin bileşkesine göre kayar.',
    view: 'mechanism',
    mech: 'tns',
    shot: { pos: [2.8, -0.55, 6.75], target: [0, -0.95, 3.45], drift: 0.25 },
    customApply: (m) => {
      m.rollRateLimit = 15;
      let t = 0;
      m.script = (mm, dt) => {
        t += dt;
        mm.target.bank = stdBank(mm.target.speed);
        mm.target.rudder = Math.sin(t * 1.4) * 0.6;
        return true;
      };
    },
  },
  {
    act: 'Mekanizma',
    title: '9 · Turn & Slip: Yatay Cayro ve Presesyon',
    text: 'Vakum hava jeti nozülü, pirinç rotorun çevresindeki 28 türbin çentiğine hava üfleyerek rotoru döndürür. Uçak sağa yaw yaptığında cayro 90° faz farkıyla presesyon yapar ve gimbalın üstü sola yatar.',
    view: 'mechanism',
    mech: 'tns',
    shot: { pos: [6.2, 2.7, -0.4], target: [0, 0.45, -0.5], drift: 0.4 },
    customApply: turnCycleScript(9),
  },
  {
    act: 'Mekanizma',
    title: '10 · Turn & Slip: Dairesel Plaka ve Tersleyici Çatal-Pim',
    text: 'Sağa dönüşte gimbalın üstü sola yatarken, dairesel plaka merkezinden aşağı inen tahrik pimi sağa savrulur ve alt iğne milindeki çatalı sağa iter. Böylece iğne dönüş yönüyle aynı tarafa sapar.',
    view: 'mechanism',
    mech: 'tns',
    shot: { pos: [4.3, 0.25, 4.15], target: [0, -0.18, 2.15], drift: 0.25 },
    customApply: turnCycleScript(8),
  },
  {
    act: 'Mekanizma',
    title: '11 · Turn & Slip: Kalibrasyon Yayı ve Pnömatik Dashpot',
    text: 'Soldaki kalibrasyon yayı presesyona direnç göstererek sapma açısının dönüş hızıyla (rate of turn) orantılı olmasını sağlar. Sağdaki dikey dashpot pistonu ise ani sarsıntıları sönümler.',
    view: 'mechanism',
    mech: 'tns',
    shot: { pos: [4.8, 2.1, 4.3], target: [0, 0.65, 1.98], drift: 0.3 },
    customApply: turnCycleScript(8),
  },
  {
    act: 'Mekanizma',
    title: '12 · Turn Coordinator: 30° Yukarı Eğik Gimbal Ekseni',
    text: "Yandan bakışta gimbal ekseninin 30° yukarı eğik olduğuna dikkat edin! Bu eğim sayesinde cayro hem dikey (yaw) hem boyuna (roll) eksen etrafındaki dönüşleri algılar ve yatış başlar başlamaz pilotu uyarır.",
    view: 'mechanism',
    mech: 'tc',
    shot: { pos: [7.6, 1.35, 0.9], target: [0, 0.15, 0.35], drift: 0.35 },
    customApply: (m) => {
      m.rollRateLimit = 6;
      m.target.rudder = 0;
      let t = 0;
      m.script = (mm, dt) => {
        t = (t + dt) % 8.0;
        const sb = stdBank(mm.target.speed);
        mm.target.bank = t < 4.0 ? sb : -sb;
        return true;
      };
    },
  },
  {
    act: 'Mekanizma',
    title: '13 · Turn Coordinator: Sektör-Pinyon Dişlisi ve Cam Damper',
    text: 'Eğik gimbalın önünden yükselen sektör dişli, merkez mildeki pinyon dişliyi çevirerek uçak silüetini yatırır. Yandaki cam tüplü grafit piston sarsıntıları süzerken arka PCB elektrikli rotoru sürer.',
    view: 'mechanism',
    mech: 'tc',
    shot: { pos: [5.1, 1.05, 3.65], target: [0.05, -0.08, 1.45], drift: 0.32 },
    customApply: turnCycleScript(8),
  },
];
