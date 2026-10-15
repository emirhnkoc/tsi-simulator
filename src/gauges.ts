import { clamp } from './physics';

// Her iki göstergede de standart dönüş işareti merkezden 20° uzakta.
export const STD_MARK_DEG = 20;
const MAX_DEFLECTION = 40;

/** Gyro sinyalini (°/s) gösterge sapma açısına çevirir. 3°/s = standart işaret. */
export const signalToAngle = (signal: number) =>
  clamp((signal / 3) * STD_MARK_DEG, -MAX_DEFLECTION, MAX_DEFLECTION);

// ---- Ortak parçalar --------------------------------------------------------

const TUBE_R = 300; // top tüpünün eğrilik yarıçapı (px)
const TUBE_HALF = 16; // tüpün yarım açısı (derece)
const BALL_MAX = 13.5;

function bezel(id: string) {
  return `
    <defs>
      <radialGradient id="${id}-bezel" cx="50%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#9a9a9a"/>
        <stop offset="60%" stop-color="#4a4a4a"/>
        <stop offset="100%" stop-color="#1a1a1a"/>
      </radialGradient>
      <radialGradient id="${id}-ball" cx="35%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#8a8a8a"/>
        <stop offset="35%" stop-color="#1c1c1c"/>
        <stop offset="100%" stop-color="#000"/>
      </radialGradient>
      <linearGradient id="${id}-tube" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#d9d9d9"/>
      </linearGradient>
      <radialGradient id="${id}-glass" cx="30%" cy="20%" r="80%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.10"/>
        <stop offset="50%" stop-color="#fff" stop-opacity="0.02"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="150" cy="150" r="149" fill="url(#${id}-bezel)"/>
    <circle cx="150" cy="150" r="139" fill="#0c0c0c"/>`;
}

function tubeGeometry(bottomY: number) {
  const yc = bottomY - TUBE_R;
  const s = Math.sin(TUBE_HALF * (Math.PI / 180));
  const c = Math.cos(TUBE_HALF * (Math.PI / 180));
  const x1 = 150 - TUBE_R * s;
  const x2 = 150 + TUBE_R * s;
  const y = yc + TUBE_R * c;
  return { yc, path: `M ${x1} ${y} A ${TUBE_R} ${TUBE_R} 0 0 0 ${x2} ${y}` };
}

function tube(id: string, bottomY: number) {
  const { path } = tubeGeometry(bottomY);
  return `
    <path d="${path}" stroke="#222" stroke-width="34" stroke-linecap="round" fill="none"/>
    <path d="${path}" stroke="url(#${id}-tube)" stroke-width="30" stroke-linecap="round" fill="none"/>
    <g id="${id}-ballg"><circle r="13" fill="url(#${id}-ball)"/></g>
    <line x1="135" y1="${bottomY - 17}" x2="135" y2="${bottomY + 17}" stroke="#1a1a1a" stroke-width="3"/>
    <line x1="165" y1="${bottomY - 17}" x2="165" y2="${bottomY + 17}" stroke="#1a1a1a" stroke-width="3"/>`;
}

function placeBall(g: SVGGElement, bottomY: number, ballDeg: number) {
  const { yc } = tubeGeometry(bottomY);
  const a = clamp(ballDeg * 0.9, -BALL_MAX, BALL_MAX) * (Math.PI / 180);
  const x = 150 + TUBE_R * Math.sin(a);
  const y = yc + TUBE_R * Math.cos(a);
  g.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
}

const glass = (id: string) =>
  `<circle cx="150" cy="150" r="139" fill="url(#${id}-glass)" pointer-events="none"/>`;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = deg * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

// ---- Turn Coordinator (Figure 5-98) -----------------------------------------

export class TurnCoordinatorGauge {
  readonly el: HTMLDivElement;
  private plane: SVGGElement;
  private ball: SVGGElement;
  private static BALL_Y = 226;

  constructor() {
    const id = 'tc';
    const marks: string[] = [];
    for (const deg of [0, STD_MARK_DEG]) {
      // sağ taraf (aşağı doğru = pozitif açı) ve sol taraf (ayna)
      for (const side of [1, -1]) {
        const a = side === 1 ? deg : 180 - deg;
        const [x1, y1] = polar(150, 150, 114, a);
        const [x2, y2] = polar(150, 150, 135, a);
        marks.push(
          `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="7"/>`,
        );
      }
    }
    this.el = document.createElement('div');
    this.el.className = 'gauge-svg';
    this.el.innerHTML = `
      <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        ${bezel(id)}
        <circle cx="150" cy="150" r="112" fill="#2e2e30"/>
        ${marks.join('')}
        <text x="150" y="44" class="g-small" text-anchor="middle">D.C.</text>
        <text x="150" y="58" class="g-small" text-anchor="middle">ELEC.</text>
        <text x="84" y="262" class="g-big" text-anchor="middle">L</text>
        <text x="216" y="262" class="g-big" text-anchor="middle">R</text>
        <text x="150" y="196" class="g-mid" text-anchor="middle">TURN COORDINATOR</text>
        ${tube(id, TurnCoordinatorGauge.BALL_Y)}
        <text x="150" y="262" class="g-label" text-anchor="middle">2 MIN.</text>
        <text x="150" y="277" class="g-tiny" text-anchor="middle">NO PITCH INFORMATION</text>
        <g id="${id}-plane">
          <rect x="45" y="146" width="210" height="8" rx="3" fill="#f4f4f4"/>
          <rect x="146" y="116" width="8" height="26" rx="2" fill="#f4f4f4"/>
          <rect x="128" y="124" width="44" height="5" rx="2" fill="#f4f4f4"/>
          <circle cx="150" cy="150" r="15" fill="#f4f4f4"/>
          <circle cx="150" cy="150" r="5" fill="#bbb"/>
        </g>
        ${glass(id)}
      </svg>`;
    this.plane = this.el.querySelector(`#${id}-plane`)!;
    this.ball = this.el.querySelector(`#${id}-ballg`)!;
    this.update(0, 0);
  }

  update(signal: number, ballDeg: number) {
    const angle = signalToAngle(signal);
    this.plane.setAttribute('transform', `rotate(${angle.toFixed(2)} 150 150)`);
    placeBall(this.ball, TurnCoordinatorGauge.BALL_Y, ballDeg);
  }
}

// ---- Turn-and-Slip Indicator (Figure 5-99) ----------------------------------

export class TurnSlipGauge {
  readonly el: HTMLDivElement;
  private needle: SVGGElement;
  private ball: SVGGElement;
  private static BALL_Y = 222;
  private static PIVOT_Y = 168;

  constructor() {
    const id = 'tns';
    const py = TurnSlipGauge.PIVOT_Y;
    const marks: string[] = [];
    for (const deg of [-STD_MARK_DEG, 0, STD_MARK_DEG]) {
      // Merkezde "doghouse", yanlarda standart dönüş işaretleri
      const shape =
        deg === 0
          ? `<polygon points="-15,-12 15,-12 15,2 0,10 -15,2" fill="#f4f4f4"/>`
          : `<polygon points="-8,-12 8,-12 8,4 0,12 -8,4" fill="#f4f4f4"/>`;
      marks.push(
        `<g transform="rotate(${deg} 150 ${py}) translate(150 ${py - 128})">${shape}</g>`,
      );
    }
    this.el = document.createElement('div');
    this.el.className = 'gauge-svg';
    this.el.innerHTML = `
      <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        ${bezel(id)}
        <circle cx="150" cy="150" r="130" fill="#2a2a2c"/>
        ${marks.join('')}
        <text x="92" y="92" class="g-big" text-anchor="middle">L</text>
        <text x="208" y="92" class="g-big" text-anchor="middle">R</text>
        <rect x="214" y="120" width="24" height="30" fill="#111" stroke="#666" stroke-width="2"/>
        ${tube(id, TurnSlipGauge.BALL_Y)}
        <text x="150" y="260" class="g-label" text-anchor="middle">2 MIN  TURN</text>
        <text x="150" y="276" class="g-tiny" text-anchor="middle">DC   ELEC</text>
        <g id="${id}-needle">
          <polygon points="146,${py} 154,${py} 152.5,${py - 70} 157,${py - 78} 150,${py - 114} 143,${py - 78} 147.5,${py - 70}" fill="#f4f4f4"/>
        </g>
        <circle cx="150" cy="${py}" r="11" fill="#1b1b1b" stroke="#777" stroke-width="3"/>
        <circle cx="150" cy="${py}" r="4" fill="#555"/>
        ${glass(id)}
      </svg>`;
    this.needle = this.el.querySelector(`#${id}-needle`)!;
    this.ball = this.el.querySelector(`#${id}-ballg`)!;
    this.update(0, 0);
  }

  update(signal: number, ballDeg: number) {
    const angle = signalToAngle(signal);
    this.needle.setAttribute(
      'transform',
      `rotate(${angle.toFixed(2)} 150 ${TurnSlipGauge.PIVOT_Y})`,
    );
    placeBall(this.ball, TurnSlipGauge.BALL_Y, ballDeg);
  }
}
