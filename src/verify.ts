// Exhaustive checks of the Wrzos-Kaminska strategy and of first-player "trap" play against a
// fallible second player.

import { type Board, Solver, Symmetry, closesTriangle, LOSS, WIN } from './sim.ts';
import { type StrategyOptions, strategySteps } from './strategy.ts';

export interface StrategyReport {
  /** true when Blue wins every game: any Red play, any mini-board, any move the rules leave */
  wins: boolean;
  /** distinct labelled / isomorphism classes of positions in which the strategy has to move */
  decisions: number;
  decisionClasses: number;
  /** classes in which rule 1 alone leaves one move, rule 2 decides, rule 3 decides, >1 left */
  byRule1: number;
  byRule2: number;
  byRule3: number;
  leftOver: number;
  /** classes in which some move the rules leave loses against perfect Red play */
  admitsLosing: number;
  /** classes with more than one mini-board, and how many of those were not all isomorphic */
  severalBoards: number;
  nonIsomorphicBoards: number;
  /** the earliest position (fewest coloured edges) in which the rules leave a losing move */
  firstBlunder: Blunder | null;
  /** classes in which the rules leave no move at all (no mini-board exists) */
  stuck: number;
  /** longest game when Blue follows the strategy, in plies (-1 when the strategy can be beaten) */
  longest: number;
}

export interface Blunder {
  red: number;
  blue: number;
  /** moves the rules leave, and the ones among them that lose */
  allowed: number;
  losing: number;
  /** plies in which perfect Red then wins after the first losing move */
  redWinsIn: number;
}

/**
 * Walk every game in which Red plays anything and Blue plays any move the rules leave (on any
 * mini-board). Nothing is cut short, so the counts cover the whole tree the rules allow.
 */
export function checkStrategy(
  b: Board,
  solver: Solver,
  sym: Symmetry,
  opt: StrategyOptions = {},
): StrategyReport {
  const full = (1 << b.E) - 1;
  const S = 2 ** b.E;
  const memo = new Map<number, number>(); // red-to-move key -> longest game from here
  const seen = new Set<number>();
  const labelled = new Set<number>();
  const rep: StrategyReport = {
    wins: true,
    decisions: 0,
    decisionClasses: 0,
    byRule1: 0,
    byRule2: 0,
    byRule3: 0,
    leftOver: 0,
    admitsLosing: 0,
    severalBoards: 0,
    nonIsomorphicBoards: 0,
    firstBlunder: null,
    stuck: 0,
    longest: 0,
  };
  let blunderKey = Infinity;

  const classify = (red: number, blue: number, steps: ReturnType<typeof strategySteps>) => {
    labelled.add(red * S + blue);
    const c = sym.canonical(red, blue);
    if (seen.has(c)) return;
    seen.add(c);
    if (steps.length === 0) {
      rep.stuck++;
      rep.wins = false;
      return;
    }
    const s = steps[0];
    const n1 = popc(s.rule1), n2 = popc(s.rule2), n3 = popc(s.rule3);
    if (n1 === 1) rep.byRule1++;
    else if (n2 === 1) rep.byRule2++;
    else if (n3 === 1) rep.byRule3++;
    else rep.leftOver++;
    let allowed = 0, losing = 0, depth = 0;
    for (const st of steps) allowed |= st.rule3;
    for (let f = allowed; f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      const v = solver.value(red, blue | (1 << e));
      if (v.outcome !== LOSS) {
        losing |= 1 << e;
        depth = Math.max(depth, v.depth);
      }
    }
    if (losing) {
      rep.admitsLosing++;
      rep.wins = false;
      // earliest position first, then the smallest canonical key, so the example is reproducible
      const k = popc(red | blue) * 2 ** 31 + c;
      if (k < blunderKey) {
        blunderKey = k;
        const cr = Math.floor(c / S), cb = c % S;
        const p = sym.perms.findIndex((_, i) => sym.apply(i, red) === cr && sym.apply(i, blue) === cb);
        rep.firstBlunder = {
          red: cr,
          blue: cb,
          allowed: sym.apply(p, allowed),
          losing: sym.apply(p, losing),
          redWinsIn: depth,
        };
      }
    }
    if (steps.length > 1) {
      rep.severalBoards++;
      // every pair of mini-boards must be related by a relabelling that fixes the colouring
      const autos = sym.perms.filter((_, p) => sym.apply(p, red) === red && sym.apply(p, blue) === blue);
      const ok = steps.every((st) => autos.some((perm) => mapVerts(perm, steps[0].board) === st.board));
      if (!ok) rep.nonIsomorphicBoards++;
    }
  };

  const redTurn = (red: number, blue: number): number => {
    const key = red * S + blue;
    const m = memo.get(key);
    if (m !== undefined) return m;
    let longest = 0;
    const free = full & ~(red | blue);
    for (let f = free; f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      if (closesTriangle(b, red, e)) {
        longest = Math.max(longest, 1);
        continue;
      }
      const r2 = red | (1 << e);
      const steps = strategySteps(b, r2, blue, opt);
      classify(r2, blue, steps);
      let moves = 0;
      for (const st of steps) moves |= st.rule3;
      for (let g = moves; g; g &= g - 1) {
        const x = 31 - Math.clz32(g & -g);
        if (closesTriangle(b, blue, x)) throw new Error('rule 1 let a triangle through');
        longest = Math.max(longest, redTurn(r2, blue | (1 << x)) + 2);
      }
    }
    memo.set(key, longest);
    return longest;
  };

  const longest = redTurn(0, 0);
  rep.longest = rep.wins ? longest : -1;
  rep.decisions = labelled.size;
  rep.decisionClasses = seen.size;
  return rep;
}

function popc(x: number): number {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

function mapVerts(perm: number[], vs: number): number {
  let out = 0;
  for (let v = 0; v < perm.length; v++) if (vs & (1 << v)) out |= 1 << perm[v];
  return out;
}

export type RedPolicy = 'random' | 'slany-count' | 'slany-share' | 'optimal';

/**
 * Probability that Red (the first player, who loses against perfect play) wins against a Blue who
 * picks uniformly among the moves that do not close a blue triangle. Once Red reaches a won
 * position it plays perfectly. Before that Red plays by `policy`:
 *   random      — uniformly among moves that do not close a red triangle
 *   slany-count — the move after which the most Blue replies are blunders (Slany 1999)
 *   slany-share — the move after which the largest share of Blue's replies are blunders
 *   optimal     — the move that maximises the winning probability (exact expectimax)
 */
export function trapProbability(b: Board, solver: Solver, policy: RedPolicy): number {
  const full = (1 << b.E) - 1;
  const S = 2 ** b.E;
  const memo = new Map<number, number>();

  const blueTurn = (red: number, blue: number): number => {
    const key = red * S + blue;
    const m = memo.get(key);
    if (m !== undefined) return m;
    const free = full & ~(red | blue);
    let n = 0, sum = 0;
    for (let f = free; f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      if (closesTriangle(b, blue, e)) continue;
      n++;
      sum += redTurn(red, blue | (1 << e));
    }
    const p = n === 0 ? 1 : sum / n; // no safe move: Blue must close a triangle
    memo.set(key, p);
    return p;
  };

  const redTurn = (red: number, blue: number): number => {
    const key = red * S + blue;
    const m = memo.get(key);
    if (m !== undefined) return m;
    let p: number;
    if (solver.value(red, blue).outcome === WIN) p = 1;
    else {
      const free = full & ~(red | blue);
      const options: number[] = [];
      for (let f = free; f; f &= f - 1) {
        const e = 31 - Math.clz32(f & -f);
        if (!closesTriangle(b, red, e)) options.push(e);
      }
      if (options.length === 0) p = 0;
      else if (policy === 'random') {
        p = options.reduce((s, e) => s + blueTurn(red | (1 << e), blue), 0) / options.length;
      } else if (policy === 'optimal') {
        p = Math.max(...options.map((e) => blueTurn(red | (1 << e), blue)));
      } else {
        const score = options.map((e) => blunders(red | (1 << e), blue, policy === 'slany-share'));
        const best = Math.max(...score);
        const chosen = options.filter((_, i) => score[i] === best);
        p = chosen.reduce((s, e) => s + blueTurn(red | (1 << e), blue), 0) / chosen.length;
      }
    }
    memo.set(key, p);
    return p;
  };

  // Blue replies after which Red is winning, as a count or a share of Blue's safe replies
  const blunders = (red: number, blue: number, share: boolean): number => {
    const free = full & ~(red | blue);
    let safe = 0, bad = 0;
    for (let f = free; f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      if (closesTriangle(b, blue, e)) continue;
      safe++;
      if (solver.value(red, blue | (1 << e)).outcome === WIN) bad++;
    }
    if (safe === 0) return share ? 1 : Infinity;
    return share ? bad / safe : bad;
  };

  return redTurn(0, 0);
}

/** Both players uniformly random among moves that do not close their own triangle. */
export function randomVsRandom(b: Board): number {
  const full = (1 << b.E) - 1;
  const S = 2 ** b.E;
  const memo = new Map<number, number>();
  // probability that the side to move wins
  const rec = (red: number, blue: number, redMoves: boolean): number => {
    const key = red * S + blue;
    const m = memo.get(key);
    if (m !== undefined) return m;
    const mine = redMoves ? red : blue;
    const free = full & ~(red | blue);
    let n = 0, sum = 0;
    for (let f = free; f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      if (closesTriangle(b, mine, e)) continue;
      n++;
      sum += 1 - (redMoves ? rec(red | (1 << e), blue, false) : rec(red, blue | (1 << e), true));
    }
    const p = n === 0 ? 0 : sum / n;
    memo.set(key, p);
    return p;
  };
  return rec(0, 0, true);
}

/**
 * Red's best "trap" play when it is losing: the move that maximises the chance that a Blue who
 * picks uniformly among safe moves goes wrong (exact expectimax, memoised). Used by the page.
 */
export class TrapPlayer {
  private readonly memo = new Map<number, number>();
  private readonly b: Board;
  private readonly solver: Solver;
  private readonly S: number;
  private readonly full: number;
  constructor(b: Board, solver: Solver) {
    this.b = b;
    this.solver = solver;
    this.S = 2 ** b.E;
    this.full = (1 << b.E) - 1;
  }

  /** probability that Red wins from a Red-to-move position */
  redChance(red: number, blue: number): number {
    const key = red * this.S + blue;
    const m = this.memo.get(key);
    if (m !== undefined) return m;
    let p = 0;
    if (this.solver.value(red, blue).outcome === WIN) p = 1;
    else
      for (const { chance } of this.moveChances(red, blue)) p = Math.max(p, chance);
    this.memo.set(key, p);
    return p;
  }

  /** Red's safe moves with the winning chance after each */
  moveChances(red: number, blue: number): { edge: number; chance: number }[] {
    const out: { edge: number; chance: number }[] = [];
    for (let f = this.full & ~(red | blue); f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      if (!closesTriangle(this.b, red, e)) out.push({ edge: e, chance: this.blueChance(red | (1 << e), blue) });
    }
    return out;
  }

  private blueChance(red: number, blue: number): number {
    const key = red * this.S + blue;
    const m = this.memo.get(key);
    if (m !== undefined) return m;
    let n = 0, sum = 0;
    for (let f = this.full & ~(red | blue); f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      if (closesTriangle(this.b, blue, e)) continue;
      n++;
      sum += this.redChance(red, blue | (1 << e));
    }
    const p = n === 0 ? 1 : sum / n;
    this.memo.set(key, p);
    return p;
  }
}
