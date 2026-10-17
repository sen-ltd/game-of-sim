import { describe, expect, it } from 'vitest';
import {
  makeBoard, Solver, Symmetry, enumeratePositions, classesByBurnside, reachable, hasTriangle, closesTriangle,
  redToMove, maskOf, maskNames, LOSS, DRAW, WIN,
} from './sim.ts';
import { miniBoards, maximumAllowedSets, spanned, strategySteps } from './strategy.ts';
import { checkStrategy, trapProbability, randomVsRandom, TrapPlayer } from './verify.ts';
import { polyaTable, diagonalSum, partitions, edgeCycles } from './polya.ts';
import { hasK4, makeSampler } from './montecarlo.ts';

const b6 = makeBoard(6);
const solver = new Solver(b6);
const sym = new Symmetry(b6);

/** vertex mask from 1-based labels */
const verts = (...vs: number[]) => vs.reduce((m, v) => m | (1 << (v - 1)), 0);

describe('board', () => {
  it('K6 has 15 edges and 20 triangles', () => {
    expect(b6.E).toBe(15);
    expect(b6.triangles.length).toBe(20);
    expect(sym.perms.length).toBe(720);
  });

  it('R(3,3) = 6: every red/blue colouring of K6 has a monochromatic triangle, K5 does not', () => {
    const full = (1 << 15) - 1;
    for (let red = 0; red <= full; red++) expect(hasTriangle(b6, red) || hasTriangle(b6, full & ~red)).toBe(true);
    const b5 = makeBoard(5);
    const pentagon = maskOf(b5, ['12', '23', '34', '45', '15']);
    expect(hasTriangle(b5, pentagon) || hasTriangle(b5, ((1 << 10) - 1) & ~pentagon)).toBe(false);
  });
});

describe('perfect play', () => {
  it('the second player wins Sim, and the game always lasts all 15 moves', () => {
    expect(solver.value(0, 0)).toEqual({ outcome: LOSS, depth: 15 });
    expect(solver.visited).toBe(1_350_022);
  });

  it('K3, K4 and K5 are draws', () => {
    for (const n of [3, 4, 5]) expect(new Solver(makeBoard(n)).value(0, 0).outcome).toBe(DRAW);
  });

  it('agrees with plain negamax over a Map on every reachable K6 position (value and depth)', () => {
    const memo = new Map<string, [number, number]>();
    const naive = (red: number, blue: number): [number, number] => {
      const key = `${red},${blue}`;
      const m = memo.get(key);
      if (m) return m;
      const redMoves = redToMove(red, blue);
      let best: [number, number] | null = null;
      for (let e = 0; e < 15; e++) {
        if ((red | blue) & (1 << e)) continue;
        const mine = redMoves ? red | (1 << e) : blue | (1 << e);
        let r: [number, number];
        if (hasTriangle(b6, mine)) r = [LOSS, 1];
        else {
          const [o, d] = redMoves ? naive(red | (1 << e), blue) : naive(red, blue | (1 << e));
          r = [2 - o, d + 1];
        }
        // win fast, lose slow
        if (!best || r[0] > best[0] || (r[0] === best[0] && (r[0] === WIN ? r[1] < best[1] : r[1] > best[1]))) best = r;
      }
      if (!best) best = [DRAW, 0];
      memo.set(key, best);
      return best;
    };
    naive(0, 0);
    expect(memo.size).toBe(solver.visited);
    for (const [r, bl] of reachable(solver)) {
      const v = solver.value(r, bl);
      expect([v.outcome, v.depth]).toEqual(memo.get(`${r},${bl}`));
    }
  });

  it("Blue's first reply does not matter: both classes win in 14 plies", () => {
    for (const m of solver.moves(1, 0)) expect(m).toMatchObject({ outcome: WIN, depth: 14 });
  });
});

describe('position counts (Slany 1999)', () => {
  const levels = enumeratePositions(b6, sym);
  const classes = levels.reduce((s, l) => s + l.classes, 0);
  const terminal = levels.reduce((s, l) => s + l.terminalClasses, 0);

  it('2,250 triangle-free classes and 1,479 finished ones: 3,728 without the empty board', () => {
    expect(classes).toBe(2250);
    expect(terminal).toBe(1479);
    expect(classes + terminal - 1).toBe(3728);
    expect(levels.reduce((s, l) => s + l.labelled, 0)).toBe(solver.visited);
  });

  it('level classes agree with a Burnside count on K5', () => {
    const b5 = makeBoard(5);
    const s5 = new Solver(b5), y5 = new Symmetry(b5);
    const l5 = enumeratePositions(b5, y5);
    expect(classesByBurnside(y5, reachable(s5))).toBe(l5.reduce((s, l) => s + l.classes, 0));
  });
});

describe('Pólya counts', () => {
  it('partitions and edge cycles are consistent', () => {
    expect(partitions(18).length).toBe(385);
    for (const m of partitions(7)) expect(edgeCycles(m).reduce((s, l) => s + l, 0)).toBe(21);
  });

  it('K3..K6 match OEIS A004102 and a brute-force Burnside count on K5', () => {
    const totals = [3, 4, 5, 6].map((n) => polyaTable(n).count.flat().reduce((s, c) => s + c, 0n));
    expect(totals).toEqual([10n, 66n, 792n, 25506n]);
    const b5 = makeBoard(5), y5 = new Symmetry(b5);
    let fixedDiag = 0;
    const pow = 3 ** 10;
    for (let x = 0; x < pow; x++) {
      let red = 0, blue = 0, y = x;
      for (let e = 0; e < 10; e++, y = Math.floor(y / 3)) {
        if (y % 3 === 1) red |= 1 << e;
        else if (y % 3 === 2) blue |= 1 << e;
      }
      const rc = maskNames(b5, red).length, bc = maskNames(b5, blue).length;
      if (rc !== bc && rc !== bc + 1) continue;
      fixedDiag += y5.stabiliser(red, blue);
    }
    expect(fixedDiag / 120).toBe(Number(diagonalSum(polyaTable(5))));
  });

  it("K18 reproduces Slany's footnote and the (77,76) count, and A004102(18)", () => {
    const t = polyaTable(18);
    expect(diagonalSum(t).toString()).toBe('122817954504260150325481627994395745196940238595512818831');
    expect(t.count[77][76].toString()).toBe('114722035311851620271616102401');
    expect(t.count.flat().reduce((s, c) => s + c, 0n).toString()).toBe(
      '1560315761261207861498336706313606646207037327079592287770',
    );
  });
});

describe('Wrzos-Kaminska strategy (arXiv:2001.04024)', () => {
  // the position of both figures: red 14, 24, 34; blue 12, 23; Blue to move
  const red = maskOf(b6, ['14', '24', '34']);
  const blue = maskOf(b6, ['12', '23']);

  it('Figure 2: the mini-boards are K5 on 1234+5 and 1234+6, and 1234 is not one', () => {
    expect(miniBoards(b6, red, blue).sort()).toEqual([verts(1, 2, 3, 4, 5), verts(1, 2, 3, 4, 6)].sort());
    const k4 = spanned(b6, verts(1, 2, 3, 4)) & ~(red | blue);
    expect(maskNames(b6, k4)).toEqual(['13']);
    expect(closesTriangle(b6, blue, b6.edgeId[0][2])).toBe(true);
  });

  it('Figure 1: {35, 45} is Blue-allowed but not Red-allowed; {15, 35, 45} is the only maximum Blue-allowed set', () => {
    const x = maskOf(b6, ['35', '45']);
    expect(hasTriangle(b6, blue | x)).toBe(false);
    expect(hasTriangle(b6, red | x)).toBe(true);
    const cand = spanned(b6, verts(1, 2, 3, 4, 5)) & ~(red | blue);
    const m = maximumAllowedSets(b6, blue, cand);
    expect(m.size).toBe(3);
    expect(m.sets).toBe(1);
    const inMax = maskNames(b6, cand).filter((e) => m.perEdge[maskOf(b6, [e]).toString(2).length - 1] === 1);
    expect(inMax).toEqual(['15', '35', '45']);
  });

  it('wins every game, and every move the rules leave is a winning move', () => {
    const r = checkStrategy(b6, solver, sym);
    expect(r.wins).toBe(true);
    expect(r.admitsLosing).toBe(0);
    expect(r.stuck).toBe(0);
    expect(r.nonIsomorphicBoards).toBe(0);
    expect(r.decisionClasses).toBe(304);
    expect([r.byRule1, r.byRule2, r.byRule3, r.leftOver]).toEqual([6, 82, 83, 133]);
    expect(r.longest).toBe(15);
  });

  it('dropping rule 2 loses already at move 4: all six moves the rules leave lose', () => {
    const r = checkStrategy(b6, solver, sym, { rule2: false });
    expect(r.wins).toBe(false);
    const fb = r.firstBlunder!;
    expect(maskNames(b6, fb.red)).toEqual(['12', '13']);
    expect(maskNames(b6, fb.blue)).toEqual(['23']);
    expect(maskNames(b6, fb.losing)).toEqual(['24', '25', '26', '34', '35', '36']);
    expect(fb.allowed).toBe(fb.losing);
    // and the rules with rule 2 avoid them
    const step = strategySteps(b6, fb.red, fb.blue)[0];
    expect(step.rule3 & fb.losing).toBe(0);
  });

  it('dropping rule 3, or using the whole K6 instead of the mini-board, also loses', () => {
    expect(checkStrategy(b6, solver, sym, { rule3: false }).wins).toBe(false);
    expect(checkStrategy(b6, solver, sym, { miniBoard: false }).wins).toBe(false);
  });
});

describe('trap play against a random Blue', () => {
  it('orders random < Slany < optimal, and the page player reproduces the optimum', () => {
    const p = {
      random: trapProbability(b6, solver, 'random'),
      count: trapProbability(b6, solver, 'slany-count'),
      share: trapProbability(b6, solver, 'slany-share'),
      optimal: trapProbability(b6, solver, 'optimal'),
    };
    expect(p.random).toBeLessThan(p.count);
    expect(p.count).toBeLessThanOrEqual(p.share);
    expect(p.share).toBeLessThan(p.optimal);
    expect(p.optimal).toBeLessThan(1);
    expect(new TrapPlayer(b6, solver).redChance(0, 0)).toBeCloseTo(p.optimal, 12);
    const rr = randomVsRandom(b6);
    expect(rr).toBeGreaterThan(0.45);
    expect(rr).toBeLessThan(0.55);
  });
});

describe('Monte Carlo sampler for K18', () => {
  it('finds K4s exactly', () => {
    const adj = new Int32Array(18);
    const add = (u: number, v: number) => ((adj[u] |= 1 << v), (adj[v] |= 1 << u));
    for (const [u, v] of [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3]]) add(u, v);
    expect(hasK4(adj, 18)).toBe(false);
    add(2, 3);
    expect(hasK4(adj, 18)).toBe(true);
    // Turán: the complete 3-partite graph on 18 vertices has no K4
    const t = new Int32Array(18);
    for (let u = 0; u < 18; u++) for (let v = 0; v < 18; v++) if (u % 3 !== v % 3) t[u] |= 1 << v;
    expect(hasK4(t, 18)).toBe(false);
  });

  it('is deterministic for a seed and never misses at small sizes', () => {
    expect(makeSampler(18, 7).sample(3, 3, 1000)).toBe(1000);
    expect(makeSampler(18, 7).sample(50, 50, 2000)).toBe(makeSampler(18, 7).sample(50, 50, 2000));
  });
});
