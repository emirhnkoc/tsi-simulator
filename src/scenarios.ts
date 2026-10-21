import { FlightModel, stdBank } from './physics';

export interface Scenario {
  id: string;
  label: string;
  key: string;
  apply: (m: FlightModel) => void;
}

function normal(m: FlightModel) {
  m.script = undefined;
  m.rollRateLimit = 15;
  // Senaryo seçimi göstergeleri ölü bırakmasın: güç ve rotor hazır olsun.
  m.electricPower = true;
  m.rotorSpeed = 1;
}

export const scenarios: Scenario[] = [
  {
    id: 'level',
    label: 'Düz uçuş',
    key: '1',
    apply: (m) => {
      normal(m);
      m.target.bank = 0;
      m.target.rudder = 0;
    },
  },
  {
    id: 'stdR',
    label: 'Standart sağ dönüş',
    key: '2',
    apply: (m) => {
      normal(m);
      m.target.bank = stdBank(m.target.speed);
      m.target.rudder = 0;
    },
  },
  {
    id: 'stdL',
    label: 'Standart sol dönüş',
    key: '3',
    apply: (m) => {
      normal(m);
      m.target.bank = -stdBank(m.target.speed);
      m.target.rudder = 0;
    },
  },
  {
    id: 'slip',
    label: 'Slip (kayma)',
    key: '4',
    apply: (m) => {
      // Ters rudder: yaw koordineli dönüş hızının altında kalır, top dönüşün İÇİNE kayar.
      // (Modelde 0 rudder koordinelidir; slip'i yaratan şey ters yönde rudder girdisidir.)
      normal(m);
      m.target.bank = stdBank(m.target.speed);
      m.target.rudder = -0.5;
    },
  },
  {
    id: 'skid',
    label: 'Skid (savrulma)',
    key: '5',
    apply: (m) => {
      // Gerekenden az yatış, fazla rudder: top dönüşün DIŞINA kayar
      normal(m);
      m.target.bank = Math.max(stdBank(m.target.speed) - 9, 4);
      m.target.rudder = 0.6;
    },
  },
  {
    id: 'roll',
    label: 'Roll girişi',
    key: '6',
    apply: (m) => {
      // Önce düz uçuşa gel, kısa süre bekle, sonra YAVAŞÇA standart dönüşe yat.
      // TC hemen tepki verir, T&S ise dönüş hızı oluştukça yetişir.
      normal(m);
      m.target.bank = 0;
      m.target.rudder = 0;
      let phase = 0;
      let hold = 0;
      m.script = (mm, dt) => {
        if (phase === 0) {
          if (Math.abs(mm.bank) < 0.3 && Math.abs(mm.rollRate) < 0.3) {
            hold += dt;
            if (hold > 0.4) {
              phase = 1;
              mm.rollRateLimit = 4;
              mm.target.bank = stdBank(mm.target.speed);
            }
          } else hold = 0;
          return true;
        }
        if (phase === 1) {
          // Yavaş roll tamamlanınca normal roll hızına dön; sonraki hız değişimleri hızlı tepki versin.
          if (Math.abs(mm.bank - mm.target.bank) < 0.4 && Math.abs(mm.rollRate) < 0.4) {
            mm.rollRateLimit = 15;
            return false;
          }
          return true;
        }
        return false;
      };
    },
  },
  {
    id: 'rudder',
    label: 'Sadece rudder',
    key: '7',
    apply: (m) => {
      // Kanatlar düzken rudder: uçak yaw yapar, iğne sapar, top dışa kayar (skid).
      // Not: Basitleştirilmiş modelde yaw = track kabul edilir; gerçekte rudder esas olarak
      // burnu döndürür, uçağın izi (track) daha az döner.
      normal(m);
      m.target.bank = 0;
      m.target.rudder = 0.6;
    },
  },
];
