import { CamMode } from './aircraftView';
import { MechType } from './mechanismView';

export interface PresStep {
  title: string;
  text: string;
  scenario?: string;
  cam?: CamMode;
  view?: 'aircraft' | 'mechanism';
  mech?: MechType;
  slow?: boolean;
}

/** Sınıf sunumu turu: sağ okla ilerle, sol okla geri dön, P ile çık. */
export const PRES_STEPS: PresStep[] = [
  {
    title: '1 · Ne görüyoruz?',
    text: 'Soldaki Turn Coordinator, sağdaki Turn-and-Slip göstergesi. İkisi de dönüş hızını (iğne) ve dengeyi (top) gösterir; ikisi de cayro ile çalışır.',
    scenario: 'level',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    title: '2 · Standart dönüş',
    text: "3°/s dönüş hızı iğneyi tam standart işaretine getirir. Bu hızla 360° iki dakika sürer — göstergedeki '2 MIN' yazısının anlamı budur.",
    scenario: 'stdR',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    title: '3 · Koordineli dönüş',
    text: 'Top ortada: ağırlık ile merkezkaç kuvveti dengede. Üstten bakışta dairenin düzgün kapandığını ve topun kıpırdamadığını izleyin.',
    scenario: 'stdR',
    cam: 'top',
    view: 'aircraft',
  },
  {
    title: '4 · Slip (kayma)',
    text: "Yatış fazla, rudder yetersiz: top dönüşün içine kayar. Düzeltme topun olduğu tarafa rudder vermektir — 'step on the ball'.",
    scenario: 'slip',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    title: '5 · Skid (savrulma)',
    text: 'Rudder fazla, yatış yetersiz: top dönüşün dışına savrulur. Hızlı ve savrulan dönüş, özellikle alçak irtifada tehlikelidir.',
    scenario: 'skid',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    title: '6 · Sadece rudder',
    text: 'Kanatlar düzken rudder vermek burnu kaydırır ve iğneyi saptırır, ama top dışarı kaçar: yatış olmadan koordineli dönüş olmaz.',
    scenario: 'rudder',
    cam: 'chase',
    view: 'aircraft',
  },
  {
    title: '7 · İki göstergenin farkı',
    text: "TC'nin cayrosu 30° eğik olduğu için roll hızını da algılar ve yatış başlar başlamaz tepki verir. T&S yalnızca gerçek yaw oluşunca yetişir — aradaki farkı yavaş çekimde izleyin.",
    scenario: 'roll',
    cam: 'chase',
    view: 'aircraft',
    slow: true,
  },
  {
    title: '8 · Mekanizma',
    text: 'Dönüşte cayro presesyon yapar, gimbal yatar, bağlantı çubuğu iğneyi sürer. TC modunda gimbal ekseninin 30° eğik olduğuna dikkat edin.',
    view: 'mechanism',
    mech: 'tc',
  },
];
