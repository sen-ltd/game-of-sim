// Compare the published claims with runs/*.json and write src/results.json for the page.
// Usage: node tools/literature.mts   (after npm run stats, polya and montecarlo)
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const stats = read('runs/stats.json');
const p18 = read('runs/polya-18.json');
const mc = read('runs/montecarlo.json');
const fmt = (x: number) => x.toLocaleString('en-US');

const levels = stats.levels as { ply: number; classes: number; terminalClasses: number }[];
const tf = levels.reduce((s, l) => s + l.classes, 0);
const term = levels.reduce((s, l) => s + l.terminalClasses, 0);
const k6 = stats.small.find((s: { n: number }) => s.n === 6);
const strat = stats.strategy as {
  name: string; wins: boolean; decisionClasses: number; admitsLosing: number; leftOver: number;
  severalBoards: number; nonIsomorphicBoards: number;
  firstBlunder: { red: string[]; blue: string[]; allowed: string[]; losing: string[]; redWinsIn: number } | null;
}[];
const full = strat[0];

// Monte Carlo (Slany's method 2): sum over classes of Pólya count × sampled share; normal 99% interval
const K = new Map<string, bigint>(p18.diag.map((d: { r: number; g: number; count: string }) => [`${d.r},${d.g}`, BigInt(d.count)]));
let est = 0, varSum = 0, zeroBound = 0;
const sampled = new Set<string>();
for (const c of mc.classes as { r: number; g: number; samples: number; hits: number }[]) {
  const k = Number(K.get(`${c.r},${c.g}`)!);
  const p = c.hits / c.samples;
  sampled.add(`${c.r},${c.g}`);
  est += k * p;
  varSum += (k * k * p * (1 - p)) / c.samples;
  if (c.hits === 0) zeroBound += k * (4.61 / c.samples);
}
// classes past the last sampled one: the share can only fall as edges are added, so it is below the
// 99% bound of the last (empty) sample
const lastSamples = mc.classes[mc.classes.length - 1].samples;
for (const [key, k] of K) if (!sampled.has(key)) zeroBound += Number(k) * (4.61 / lastSamples);
const sd = Math.sqrt(varSum);
const e = (x: number) => x.toExponential(3).replace('e+', '×10^');

const claims = [
  {
    claim: 'The second player wins Sim',
    source: 'Mead, Rosa & Huang 1974; Slany 1999',
    result: `yes: the empty board is a loss for Red in ${k6.plies} moves`,
    ok: k6.outcome === 'first player loses',
  },
  {
    claim: 'The second player cannot force a win before move 15',
    source: 'Slany 1999, "Further observations"',
    result: 'yes: Red can always survive until it has to colour the last line',
    ok: k6.plies === 15,
  },
  {
    claim: '3,728 non-isomorphic legal positions, counting those with a monochromatic triangle',
    source: 'Slany 1999, "Strongly solving Sim"',
    result: `yes, if the empty board is left out: ${fmt(tf - 1)} triangle-free + ${fmt(term)} finished`,
    ok: tf - 1 + term === 3728,
  },
  {
    claim: '2,309 of them without a monochromatic triangle',
    source: 'Slany 1999, "Strongly solving Sim"',
    result: `no: ${fmt(tf)} with the empty board (level-by-level canonical forms and a Burnside count agree)`,
    ok: tf === 2309,
  },
  {
    claim: "Sim+ (several lines per move) has a 13,158-entry game graph",
    source: 'Slany 1999, "Ultra-strongly solving Sim+"',
    result: `not reproduced: ${fmt(stats.simPlus.triangleFreeClasses)} triangle-free colourings; ${fmt(stats.simPlus.reachableStates)} (colouring, side to move) states reachable with Red starting, ${fmt(stats.simPlus.bothSidesToMove)} with either side`,
    ok: false,
  },
  {
    claim: 'Partial colourings of K18 with r = g or r = g + 1, up to isomorphism: 122817954504260150325481627994395745196940238595512818831',
    source: 'Slany 1999, "Sim4 and above", footnote',
    result: `identical, ${p18.ms} ms in BigInt`,
    ok: p18.gameDiagonal === '122817954504260150325481627994395745196940238595512818831',
  },
  {
    claim: '|K18(77,76)| = 114722035311851620271616102401',
    source: 'Slany 1999, "Further observations"',
    result: 'identical',
    ok: K.get('77,76')!.toString() === '114722035311851620271616102401',
  },
  {
    claim: 'About 2×10^54 legal positions of the K4 game on K18 (Monte Carlo)',
    source: 'Slany 1999, "Sim4 and above"',
    result: `yes: ${e(est)}, 99% interval ±${e(2.576 * sd)} (${fmt(mc.samples)} samples per class)`,
    ok: est > 1.5e54 && est < 2.5e54,
  },
  {
    claim: 'The three rules win for the second player',
    source: 'Wrzos-Kaminska 2020',
    result: `yes, against every Red play: ${fmt(full.decisionClasses)} position classes, longest game 15`,
    ok: full.wins,
  },
  {
    claim: 'If several moves are left after the rules, any of them wins',
    source: 'Wrzos-Kaminska 2020',
    result: `yes: ${full.leftOver} classes leave a choice, none of them a losing move`,
    ok: full.admitsLosing === 0,
  },
  {
    claim: 'The mini-board is unique up to isomorphism',
    source: 'Wrzos-Kaminska 2020',
    result: `yes: ${full.severalBoards} classes have more than one, always related by a symmetry of the position`,
    ok: full.nonIsomorphicBoards === 0,
  },
  {
    claim: 'Figure 1: {15, 35, 45} is the only maximum blue-safe set on the mini-board',
    source: 'Wrzos-Kaminska 2020',
    result: 'yes (the hidden "Fix this caption" note in the TeX source notwithstanding)',
    ok: true,
  },
];

const results = {
  solved: stats.small.map((s: { n: number; positions: number; outcome: string; plies: number }) => ({
    n: s.n, positions: s.positions, outcome: s.outcome, plies: s.plies,
  })),
  claims,
  strategy: strat.map((s) => ({
    name: s.name, wins: s.wins, classes: s.decisionClasses, admitsLosing: s.admitsLosing, firstBlunder: s.firstBlunder,
  })),
  trap: {
    random: stats.trap.random,
    slanyCount: stats.trap['slany-count'],
    slanyShare: stats.trap['slany-share'],
    optimal: stats.trap.optimal,
    randomVsRandom: stats.trap.randomVsRandom,
  },
  montecarlo: { estimate: est, sd, zeroBound, samples: mc.samples, ms: mc.ms },
};
writeFileSync('src/results.json', JSON.stringify(results, null, 1) + '\n');
for (const c of claims) console.log(`${c.ok ? '✓' : '✗'} ${c.claim}\n    ${c.result}`);
console.log(results.trap, results.montecarlo);
for (const s of results.strategy) console.log(s.name, s.wins, s.classes, s.admitsLosing, JSON.stringify(s.firstBlunder));
