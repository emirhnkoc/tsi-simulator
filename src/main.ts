import './style.css';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { FlightModel, stdBank } from './physics';
import { scenarios } from './scenarios';
import { TurnCoordinatorGauge, TurnSlipGauge } from './gauges';
import { AircraftView, CamMode } from './aircraftView';
import { MechanismView, MechType } from './mechanismView';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---- Model ve göstergeler ----
const model = new FlightModel();
const tc = new TurnCoordinatorGauge();
const tns = new TurnSlipGauge();
$('#tc-host').appendChild(tc.el);
$('#tns-host').appendChild(tns.el);

// ---- 3D ----
const host = $('#canvas-host');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'label-layer';
host.appendChild(labelRenderer.domElement);

const aircraft = new AircraftView();
const mech = new MechanismView(renderer.domElement);
type View = 'aircraft' | 'mechanism';
let view: View = 'aircraft';

function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  for (const cam of [aircraft.camera, mech.camera]) {
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
}
new ResizeObserver(resize).observe(host);
resize();

// ---- Sekmeler ----
function setActive(container: string, attr: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`${container} button`).forEach((b) => {
    b.classList.toggle('active', b.dataset[attr] === value);
  });
}

function setView(v: View) {
  view = v;
  setActive('#view-tabs', 'view', v);
  $('#cam-tabs').classList.toggle('hidden', v !== 'aircraft');
  $('#mech-tabs').classList.toggle('hidden', v !== 'mechanism');
  labelRenderer.domElement.classList.toggle('hidden', v !== 'mechanism');
  mech.controls.enabled = v === 'mechanism';
}
document.querySelectorAll<HTMLButtonElement>('#view-tabs button').forEach((b) =>
  b.addEventListener('click', () => setView(b.dataset.view as View)),
);

function setCam(c: CamMode) {
  aircraft.setCamMode(c);
  setActive('#cam-tabs', 'cam', c);
}
document.querySelectorAll<HTMLButtonElement>('#cam-tabs button').forEach((b) =>
  b.addEventListener('click', () => setCam(b.dataset.cam as CamMode)),
);

function setMech(t: MechType) {
  mech.setType(t);
  setActive('#mech-tabs', 'mech', t);
}
document.querySelectorAll<HTMLButtonElement>('#mech-tabs button').forEach((b) =>
  b.addEventListener('click', () => setMech(b.dataset.mech as MechType)),
);
setView('aircraft');

// ---- Senaryolar ----
const scenarioHost = $('#scenarios');
let activeScenario = 'level';
for (const sc of scenarios) {
  const b = document.createElement('button');
  b.dataset.id = sc.id;
  b.innerHTML = `<kbd>${sc.key}</kbd>${sc.label}`;
  b.addEventListener('click', () => runScenario(sc.id));
  scenarioHost.appendChild(b);
}
function runScenario(id: string) {
  const sc = scenarios.find((s) => s.id === id);
  if (!sc) return;
  sc.apply(model);
  if (id === 'roll') aircraft.resetTrail();
  activeScenario = id;
  setActive('#scenarios', 'id', id);
}
setActive('#scenarios', 'id', activeScenario);

// ---- Slider'lar ----
const sBank = $<HTMLInputElement>('#s-bank');
const sRudder = $<HTMLInputElement>('#s-rudder');
const sSpeed = $<HTMLInputElement>('#s-speed');

function manualInput() {
  model.script = undefined;
  model.rollRateLimit = 15;
  activeScenario = '';
  setActive('#scenarios', 'id', '');
}
sBank.addEventListener('input', () => {
  manualInput();
  model.target.bank = parseFloat(sBank.value);
});
sRudder.addEventListener('input', () => {
  manualInput();
  model.target.rudder = parseFloat(sRudder.value);
});
sSpeed.addEventListener('input', () => {
  // Hız değişince senaryo korunur (ör. standart dönüş yatışı yeniden hesaplanır)
  model.target.speed = parseFloat(sSpeed.value);
  if (activeScenario === 'stdR') model.target.bank = stdBank(model.target.speed);
  if (activeScenario === 'stdL') model.target.bank = -stdBank(model.target.speed);
});

function syncSliders() {
  const act = document.activeElement;
  if (act !== sBank) sBank.value = String(model.target.bank);
  if (act !== sRudder) sRudder.value = String(model.target.rudder);
  if (act !== sSpeed) sSpeed.value = String(model.target.speed);
  $('#v-bank').textContent = `${fmtSigned(model.target.bank, 1)}°`;
  $('#v-rudder').textContent = fmtSigned(model.target.rudder, 2);
  $('#v-speed').textContent = `${model.target.speed.toFixed(0)} kt`;
}

// ---- Oynatma ----
let paused = false;
let slow = false;
const SLOW_FACTOR = 0.25;

function updatePlayback() {
  $('#b-pause').classList.toggle('on', paused);
  $('#b-pause').textContent = paused ? '▶ Devam' : '⏸ Duraklat';
  $('#b-slow').classList.toggle('on', slow);
  const badge = $('#time-badge');
  badge.classList.toggle('hidden', !paused && !slow);
  badge.textContent = paused ? '⏸ Duraklatıldı' : `🐢 Yavaş çekim ×${SLOW_FACTOR}`;
}
$('#b-pause').addEventListener('click', () => {
  paused = !paused;
  updatePlayback();
});
$('#b-slow').addEventListener('click', () => {
  slow = !slow;
  updatePlayback();
});

function togglePanel() {
  const hidden = $('#app').classList.toggle('panel-hidden');
  $('#b-show').classList.toggle('hidden', !hidden);
}
$('#b-hide').addEventListener('click', togglePanel);
$('#b-show').addEventListener('click', togglePanel);

// ---- Klavye ----
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const sc = scenarios.find((s) => s.key === k);
  if (sc) return runScenario(sc.id);
  if (k === ' ') {
    e.preventDefault();
    paused = !paused;
    updatePlayback();
  } else if (k === 's') {
    slow = !slow;
    updatePlayback();
  } else if (k === 'h') togglePanel();
  else if (k === 'm') setView(view === 'aircraft' ? 'mechanism' : 'aircraft');
  else if (k === 'c') setCam(aircraft.camMode === 'chase' ? 'top' : 'chase');
  else if (k === 't') setMech(mech.type === 'tns' ? 'tc' : 'tns');
});

// ---- Sayısal değerler ----
const readoutDefs: [string, string][] = [
  ['bank', 'Yatış'],
  ['rate', 'Dönüş hızı'],
  ['std', 'Std dönüş için yatış'],
  ['t360', '360° süresi'],
  ['roll', 'Roll hızı'],
  ['latg', 'Yanal ivme'],
  ['hdg', 'Pusula'],
  ['speed', 'Hız'],
];
const readoutEls: Record<string, HTMLElement> = {};
const readouts = $('#readouts');
for (const [id, name] of readoutDefs) {
  const d = document.createElement('div');
  d.innerHTML = `<span>${name}</span><b>–</b>`;
  readouts.appendChild(d);
  readoutEls[id] = d.querySelector('b')!;
}

function fmtSigned(v: number, digits: number) {
  const r = Number(v.toFixed(digits));
  if (r === 0) return (0).toFixed(digits);
  return r > 0 ? `+${r.toFixed(digits)}` : r.toFixed(digits);
}
function dirLabel(v: number, eps: number) {
  return Math.abs(v) < eps ? '' : v > 0 ? ' Sağ' : ' Sol';
}

const statusEl = $('#status');
const statusText = { coordinated: 'Koordineli', slip: 'Slip (kayma)', skid: 'Skid (savrulma)' };
let readoutTimer = 0;

function updateReadouts() {
  const m = model;
  readoutEls.bank.textContent = `${Math.abs(m.bank).toFixed(1)}°${dirLabel(m.bank, 0.5)}`;
  readoutEls.rate.textContent = `${Math.abs(m.yawRate).toFixed(2)} °/s${dirLabel(m.yawRate, 0.05)}`;
  readoutEls.std.textContent = `${stdBank(m.speed).toFixed(1)}°`;
  readoutEls.t360.textContent =
    Math.abs(m.yawRate) < 0.05 ? '—' : `${(360 / Math.abs(m.yawRate) / 60).toFixed(2)} dk`;
  readoutEls.roll.textContent = `${Math.abs(m.rollRate).toFixed(1)} °/s${dirLabel(m.rollRate, 0.2)}`;
  readoutEls.latg.textContent = `${fmtSigned(m.lateralG, 2)} g`;
  const hdg = (((m.heading * 180) / Math.PI) % 360 + 360) % 360;
  readoutEls.hdg.textContent = `${hdg.toFixed(0).padStart(3, '0')}°`;
  readoutEls.speed.textContent = `${m.speed.toFixed(0)} kt`;

  const st = m.coordState;
  statusEl.className = `status ${st}`;
  statusEl.textContent = statusText[st];
}

// ---- Ana döngü ----
const clock = new THREE.Clock();
function frame() {
  const realDt = Math.min(clock.getDelta(), 0.05);
  const simDt = paused ? 0 : realDt * (slow ? SLOW_FACTOR : 1);

  model.step(simDt);
  tc.update(model.tcSignal, model.ballPos);
  tns.update(model.tnsSignal, model.ballPos);

  if (view === 'aircraft') {
    aircraft.update(model, simDt, realDt);
    renderer.render(aircraft.scene, aircraft.camera);
  } else {
    aircraft.update(model, simDt, realDt); // iz ve konum devam etsin
    mech.update(model, simDt);
    renderer.render(mech.scene, mech.camera);
    labelRenderer.render(mech.scene, mech.camera);
  }

  readoutTimer += realDt;
  if (readoutTimer > 0.1) {
    readoutTimer = 0;
    updateReadouts();
    syncSliders();
  }
  requestAnimationFrame(frame);
}
// ---- URL parametreleri (ör. ?s=skid&t=8&view=mechanism&mech=tc&cam=top&panel=0) ----
{
  const q = new URLSearchParams(location.search);
  const s = q.get('s');
  if (s) runScenario(s);
  if (q.get('view') === 'mechanism') setView('mechanism');
  if (q.get('mech') === 'tc') setMech('tc');
  if (q.get('cam') === 'top') setCam('top');
  if (q.get('panel') === '0') togglePanel();
  const warm = parseFloat(q.get('t') ?? '0');
  // Belirtilen süre kadar simülasyonu önceden ilerlet
  for (let i = 0; i < warm * 60; i++) {
    model.step(1 / 60);
    aircraft.update(model, 1 / 60, 1);
    mech.update(model, 1 / 60);
  }
  updateReadouts();
}

updatePlayback();
syncSliders();
requestAnimationFrame(frame);
