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
      // Gerekenden fazla yatış, yetersiz rudder: top dönüşün İÇİNE kayar
      normal(m);
      m.target.bank = stdBank(m.target.speed) + 10;
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
      // Önce düz uçuşa gel, 1 sn bekle, sonra YAVAŞÇA standart dönüşe yat.
      // TC hemen tepki verir, T&S ise dönüş hızı oluştukça yetişir.
      normal(m);
      m.target.bank = 0;
      m.target.rudder = 0;
      let phase = 0;
      let hold = 0;
      m.script = (mm, dt) => {
        if (phase === 0) {
          if (Math.abs(mm.bank) < 0.3 && Math.abs(mm.rollRate) < 0.3 && Math.abs(mm.rudder) < 0.02) {
            hold += dt;
            if (hold > 1.0) {
              phase = 1;
              mm.rollRateLimit = 4;
              mm.target.bank = stdBank(mm.target.speed);
            }
          } else hold = 0;
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
      // Kanatlar düzken rudder: uçak yaw yapar, iğne sapar, top dışa kayar (skid)
      normal(m);
      m.target.bank = 0;
      m.target.rudder = 0.6;
    },
  },
];
