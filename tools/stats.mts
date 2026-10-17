// Solve Sim on K3..K6, count positions, check the Wrzos-Kaminska strategy and its ablations, and
// price first-player trap play. Usage: node tools/stats.mts → runs/stats.json
import { writeFileSync } from 'node:fs';
import {
  makeBoard, Solver, Symmetry, enumeratePositions, classesByBurnside, reachable, closesTriangle, maskNames,
} from '../src/sim.ts';
import { checkStrategy, trapProbability, randomVsRandom } from '../src/verify.ts';

const out: Record<string, unknown> = { node: process.version };
const time = <T,>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, Math.round(performance.now() - t)];
};

// 1. perfect play on K3..K6
const small: unknown[] = [];
for (const n of [3, 4, 5, 6]) {
  const b = makeBoard(n);
  const [s, ms] = time(() => new Solver(b));
  const v = s.value(0, 0);
  small.push({ n, positions: s.visited, outcome: ['first player loses', 'draw', 'first player wins'][v.outcome], plies: v.depth, ms });
  console.log(`K${n}: ${s.visited} positions, ${JSON.stringify(v)}, ${ms} ms`);
}
out.small = small;

const b = makeBoard(6);
const [solver, solveMs] = time(() => new Solver(b));
const sym = new Symmetry(b);
out.solveMs = solveMs;

// 2. positions by ply, labelled and up to isomorphism
const [levels, levelMs] = time(() => enumeratePositions(b, sym));
out.levels = levels;
out.levelMs = levelMs;
const [burnside, burnsideMs] = time(() => classesByBurnside(sym, reachable(solver)));
out.burnside = { classes: burnside, ms: burnsideMs };
console.log(`levels ${levelMs} ms, Burnside ${burnside} classes ${burnsideMs} ms`);

// first-move values for Blue after Red's first edge: the two classes (adjacent / disjoint)
const first = solver.moves(1, 0).map((m) => ({ ...m, edge: maskNames(b, 1 << m.edge)[0] }));
out.blueReplies = first;

// forced-loss positions and earliest forced win
let mustClose = 0;
for (const [r, bl] of reachable(solver)) {
  const redMoves = r.toString(2).split('1').length === bl.toString(2).split('1').length;
  const mine = redMoves ? r : bl;
  let safe = 0;
  for (let e = 0; e < b.E; e++) if (!((r | bl) & (1 << e)) && !closesTriangle(b, mine, e)) safe++;
  if (safe === 0) mustClose++;
}
out.mustCloseLabelled = mustClose;

// 3. the strategy and its ablations
const variants = [
  ['all three rules on the mini-board', {}],
  ['rules 1 and 2 (no rule 3)', { rule3: false }],
  ['rules 1 and 3 (no rule 2)', { rule2: false }],
  ['rule 1 only', { rule2: false, rule3: false }],
  ['all three rules on the whole K6', { miniBoard: false }],
] as const;
const strat: unknown[] = [];
for (const [name, opt] of variants) {
  const [r, ms] = time(() => checkStrategy(b, solver, sym, opt));
  const fb = r.firstBlunder;
  strat.push({
    name,
    ...r,
    ms,
    firstBlunder: fb && {
      red: maskNames(b, fb.red),
      blue: maskNames(b, fb.blue),
      allowed: maskNames(b, fb.allowed),
      losing: maskNames(b, fb.losing),
      redWinsIn: fb.redWinsIn,
    },
  });
  console.log(`${name}: wins=${r.wins} classes=${r.decisionClasses} admitsLosing=${r.admitsLosing} ${ms} ms`);
}
out.strategy = strat;

// 4. trap play against a uniformly random (but triangle-avoiding) Blue
const trap: Record<string, number> = {};
for (const p of ['random', 'slany-count', 'slany-share', 'optimal'] as const) trap[p] = trapProbability(b, solver, p);
trap.randomVsRandom = randomVsRandom(b);
out.trap = trap;
console.log(trap);

// 5. Sim+ (several edges per move): classes of colourings with both colours triangle-free
const S = 2 ** b.E;
const seen = new Set<number>([0]);
let frontier = [0];
while (frontier.length) {
  const next: number[] = [];
  for (const k of frontier) {
    const red = Math.floor(k / S), blue = k % S;
    for (let e = 0; e < b.E; e++) {
      if ((red | blue) & (1 << e)) continue;
      for (const col of [0, 1]) {
        if (closesTriangle(b, col ? blue : red, e)) continue;
        const c = col ? sym.canonical(red, blue | (1 << e)) : sym.canonical(red | (1 << e), blue);
        if (!seen.has(c)) seen.add(c), next.push(c);
      }
    }
  }
  frontier = next;
}
let redEmpty = 0, blueEmpty = 0;
for (const k of seen) {
  if (Math.floor(k / S) === 0) redEmpty++;
  if (k % S === 0) blueEmpty++;
}
// reachable (colouring, side to move) with Red starting: Red to move needs both colours present
// (or the empty board); Blue to move needs some red edge.
out.simPlus = {
  triangleFreeClasses: seen.size,
  redEmptyClasses: redEmpty,
  blueEmptyClasses: blueEmpty,
  reachableStates: 1 + (seen.size - redEmpty - blueEmpty + 1) + (seen.size - redEmpty),
  bothSidesToMove: 2 * seen.size,
};
console.log(out.simPlus);

writeFileSync('runs/stats.json', JSON.stringify(out, null, 1) + '\n');
