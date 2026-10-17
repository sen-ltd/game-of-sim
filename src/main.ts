import './style.css';
import {
  makeBoard, Solver, closesTriangle, redToMove, edgeName, popcount, LOSS, WIN,
} from './sim.ts';
import { strategySteps, type StrategyStep } from './strategy.ts';
import { TrapPlayer } from './verify.ts';
import results from './results.json';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $('board') as unknown as SVGSVGElement;
const youSel = $<HTMLSelectElement>('youSel');
const blueSel = $<HTMLSelectElement>('blueSel');
const hints = $<HTMLInputElement>('hints');
const statusEl = $('status');
const movesEl = $('moves');
const NS = 'http://www.w3.org/2000/svg';
const SIZE = 520, C = SIZE / 2, R = 200;

const b = makeBoard(6);
let solver: Solver;
let trap: TrapPlayer;
interface State { red: number; blue: number }
let cur: State = { red: 0, blue: 0 };
let history: State[] = [];
let line: number[] = [];
let youRed = true;
let over: { loserRed: boolean; tri: number[] } | null = null;
let thinking = 0;
let lastStep: { step: StrategyStep; chose: number } | null = null;

const fmt = (x: number) => x.toLocaleString('en-US');
const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

function el(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

// vertex 1 on the right, counter-clockwise, as in the figures of the 2020 paper
const vx = (v: number) => C + R * Math.cos((v * Math.PI) / 3);
const vy = (v: number) => C - R * Math.sin((v * Math.PI) / 3);

/** where an edge's hint tag goes: the midpoint, except the three long diagonals (they meet in the centre) */
function tagXY(e: number): { x: number; y: number } {
  const [u, v] = b.edges[e];
  if (v - u === 3) return { x: C + 0.22 * (vx(u) - C), y: C + 0.22 * (vy(u) - C) };
  return { x: (vx(u) + vx(v)) / 2, y: (vy(u) + vy(v)) / 2 };
}

function sideToMoveIsRed(): boolean {
  return redToMove(cur.red, cur.blue);
}

function newGame() {
  window.clearTimeout(thinking);
  youRed = youSel.value === 'red';
  cur = { red: 0, blue: 0 };
  history = [];
  line = [];
  over = null;
  lastStep = null;
  render();
  maybeComputer();
}

function play(e: number) {
  const redMoves = sideToMoveIsRed();
  const mine = redMoves ? cur.red : cur.blue;
  history.push({ ...cur });
  line.push(e);
  if (redMoves) cur = { red: cur.red | (1 << e), blue: cur.blue };
  else cur = { red: cur.red, blue: cur.blue | (1 << e) };
  if (closesTriangle(b, mine, e)) {
    const [u, v] = b.edges[e];
    const after = mine | (1 << e);
    let w = 0;
    for (; w < 6; w++)
      if (w !== u && w !== v && after & (1 << b.edgeId[u][w]) && after & (1 << b.edgeId[v][w])) break;
    over = { loserRed: redMoves, tri: [u, v, w] };
  }
  render();
  maybeComputer();
}

function computerMove(): number {
  const redMoves = sideToMoveIsRed();
  const free = ((1 << b.E) - 1) & ~(cur.red | cur.blue);
  const pick = (xs: number[]) => xs[Math.floor(Math.random() * xs.length)];
  const moves = solver.moves(cur.red, cur.blue);
  const wins = moves.filter((m) => m.outcome === WIN);
  if (!redMoves && blueSel.value === 'rules') {
    const steps = strategySteps(b, cur.red, cur.blue);
    if (steps.length) {
      const step = steps[0];
      const e = pick(bits(step.rule3));
      lastStep = { step, chose: e };
      return e;
    }
  } else lastStep = null;
  if (wins.length) {
    const fastest = Math.min(...wins.map((m) => m.depth));
    return pick(wins.filter((m) => m.depth === fastest).map((m) => m.edge));
  }
  if (redMoves) {
    // losing as Red: set the trap a hurried Blue is most likely to fall into
    const ch = trap.moveChances(cur.red, cur.blue);
    if (ch.length) {
      const best = Math.max(...ch.map((c) => c.chance));
      return pick(ch.filter((c) => c.chance >= best - 1e-12).map((c) => c.edge));
    }
  }
  const safe = moves.filter((m) => m.depth > 1);
  if (safe.length) {
    const slowest = Math.max(...safe.map((m) => m.depth));
    return pick(safe.filter((m) => m.depth === slowest).map((m) => m.edge));
  }
  return pick(bits(free));
}

function maybeComputer() {
  if (over) return;
  if (sideToMoveIsRed() === youRed) return;
  thinking = window.setTimeout(() => play(computerMove()), 450);
}

function bits(m: number): number[] {
  const out: number[] = [];
  for (let e = 0; e < b.E; e++) if (m & (1 << e)) out.push(e);
  return out;
}

function render() {
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.innerHTML = '';
  const redMoves = sideToMoveIsRed();
  const yourTurn = !over && redMoves === youRed;
  const showHints = hints.checked && !over;
  const values = !over ? new Map(solver.moves(cur.red, cur.blue).map((m) => [m.edge, m])) : new Map();
  const last = line.length ? line[line.length - 1] : -1;
  const mbVerts = lastStep && !over ? lastStep.step.board : 0;

  if (over) {
    const [a, c, d] = over.tri;
    el('polygon', { class: 'tri', points: [a, c, d].map((v) => `${vx(v)},${vy(v)}`).join(' ') }, svg);
  }
  for (let e = 0; e < b.E; e++) {
    const [u, v] = b.edges[e];
    const bit = 1 << e;
    let cls = 'edge';
    if (cur.red & bit) cls += ' red';
    else if (cur.blue & bit) cls += ' blue';
    if (e === last) cls += ' last';
    el('line', { class: cls, x1: vx(u), y1: vy(u), x2: vx(v), y2: vy(v) }, svg);
  }
  if (yourTurn) {
    for (let e = 0; e < b.E; e++) {
      if ((cur.red | cur.blue) & (1 << e)) continue;
      const [u, v] = b.edges[e];
      const hit = el('line', { class: 'hit', x1: vx(u), y1: vy(u), x2: vx(v), y2: vy(v) }, svg);
      const title = document.createElementNS(NS, 'title');
      title.textContent = `edge ${edgeName(b, e)}`;
      hit.appendChild(title);
      hit.addEventListener('click', () => play(e));
      el('line', { class: 'hov', x1: vx(u), y1: vy(u), x2: vx(v), y2: vy(v) }, svg);
    }
  }
  if (showHints) {
    for (const [e, m] of values) {
      const { x, y } = tagXY(e);
      const cls = m.outcome === WIN ? 'win' : 'loss';
      el('rect', { class: `tag ${cls}`, x: x - 17, y: y - 10, width: 34, height: 20, rx: 6 }, svg);
      const t = el('text', { class: `taglbl ${cls}`, x, y: y + 4, 'text-anchor': 'middle' }, svg);
      t.textContent = `${m.outcome === WIN ? 'W' : 'L'}${m.depth}`;
    }
  }
  for (let v = 0; v < 6; v++) {
    el('circle', { class: `vtx${mbVerts & (1 << v) ? ' mb' : ''}`, cx: vx(v), cy: vy(v), r: 8 }, svg);
    const t = el('text', {
      class: 'vlbl',
      x: C + (R + 26) * Math.cos((v * Math.PI) / 3),
      y: C - (R + 26) * Math.sin((v * Math.PI) / 3) + 5,
      'text-anchor': 'middle',
    }, svg);
    t.textContent = String(v + 1);
  }
  renderStatus(redMoves, yourTurn);
  renderRules();
}

function renderStatus(redMoves: boolean, yourTurn: boolean) {
  const ply = popcount(cur.red | cur.blue);
  statusEl.className = '';
  if (over) {
    const youLost = over.loserRed === youRed;
    statusEl.className = youLost ? 'bad' : 'good';
    const tri = over.tri.map((v) => v + 1).sort().join('-');
    statusEl.textContent = `${over.loserRed ? 'Red' : 'Blue'} closed the triangle ${tri} on move ${ply}: ${
      youLost ? 'you lose.' : 'you win.'
    }`;
  } else {
    const v = solver.value(cur.red, cur.blue);
    const who = redMoves ? 'Red' : 'Blue';
    const verdict = v.outcome === WIN ? `${who} can force a win` : `${who} loses against perfect play`;
    let s = `Move ${ply + 1} — ${yourTurn ? `your move (${who})` : `computer (${who}) is thinking`}. ${verdict}.`;
    if (redMoves && v.outcome === LOSS) {
      s += ` A Blue who picks at random among safe edges goes wrong from here with probability ${pct(
        trap.redChance(cur.red, cur.blue),
      )}.`;
    }
    statusEl.textContent = s;
  }
  movesEl.textContent = line.length
    ? `moves: ${line.map((e, i) => `${i % 2 ? 'B' : 'R'}${edgeName(b, e)}`).join(' ')}`
    : 'Click an edge to colour it. Hints: W/L = the move wins/loses, with the number of moves left to the end.';
}

function renderRules() {
  const box = $('rules');
  if (blueSel.value !== 'rules' || !lastStep) {
    box.innerHTML =
      '<p class="fine">Set the computer\'s Blue to <em>2020 three rules</em> to see the strategy decide each move: the mini-board, then the moves left after each rule.</p>';
    return;
  }
  const { step, chose } = lastStep;
  const verts = [0, 1, 2, 3, 4, 5].filter((v) => step.board & (1 << v)).map((v) => v + 1).join('');
  const list = (m: number, score?: number[]) =>
    bits(m)
      .map((e) => (score ? `${edgeName(b, e)}<sub>${score[e]}</sub>` : edgeName(b, e)))
      .join(' ') || '—';
  box.innerHTML = `
    <div class="row"><span>mini-board</span><span>K${popcount(step.board)} on ${verts}</span></div>
    <div class="row"><span>rule 1</span><span>${list(step.rule1)}</span></div>
    <div class="row"><span>rule 2</span><span>${list(step.rule2, step.blueCount)} <span class="fine">(in how many of the largest blue-safe sets; size ${step.maxBlue})</span></span></div>
    <div class="row"><span>rule 3</span><span>${list(step.rule3, step.redCount)} <span class="fine">(in how many of the largest red-safe sets; size ${step.maxRed})</span></span></div>
    <div class="row"><span>played</span><span class="em">${edgeName(b, chose)}</span></div>`;
}

function renderSide() {
  const r = results as unknown as {
    solved: { n: number; positions: number; outcome: string; plies: number }[];
    claims: { claim: string; source: string; result: string; ok: boolean }[];
    trap: { random: number; slanyCount: number; optimal: number; randomVsRandom: number };
  };
  $('solved').innerHTML = `<table class="t"><tr><th>board</th><th>positions</th><th>perfect play</th></tr>${r.solved
    .map((s) => `<tr><td>K${s.n}</td><td>${fmt(s.positions)}</td><td>${s.outcome} (${s.plies} moves)</td></tr>`)
    .join('')}</table>
    <p class="fine">Against a Blue who picks at random among safe edges, Red wins ${pct(r.trap.random)} by playing at random,
    ${pct(r.trap.slanyCount)} with Slany's one-move trap and ${pct(r.trap.optimal)} with the best trap (exact). Two random players:
    Red wins ${pct(r.trap.randomVsRandom)}.</p>`;
  $('checks').innerHTML = `<ul class="checks">${r.claims
    .map((c) => `<li><span class="${c.ok ? 'ok' : 'ng'}">${c.ok ? '✓' : '✗'}</span> ${c.claim} <span class="fine">— ${c.source}</span><br><span class="fine">${c.result}</span></li>`)
    .join('')}</ul>`;
}

$('newgame').addEventListener('click', newGame);
$('undo').addEventListener('click', () => {
  window.clearTimeout(thinking);
  // take back to the last position where it is your move
  while (history.length) {
    cur = history.pop()!;
    line.pop();
    over = null;
    lastStep = null;
    if (sideToMoveIsRed() === youRed) break;
  }
  render();
  maybeComputer();
});
hints.addEventListener('change', render);
youSel.addEventListener('change', newGame);
blueSel.addEventListener('change', render);

statusEl.textContent = 'Solving all 1,350,022 positions…';
renderSide();
setTimeout(() => {
  solver = new Solver(b);
  trap = new TrapPlayer(b, solver);
  newGame();
}, 20);
