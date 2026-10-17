// Weronika Wrzos-Kaminska, "A simpler winning strategy for Sim" (arXiv:2001.04024, 2020).
//
// Whenever it is the second player's (Blue's) turn: fix a mini-board M — a smallest complete
// subgraph containing every coloured edge and at least one Blue-allowed move — then
//   1. consider only Blue-allowed moves on M,
//   2. keep the moves that lie in the most maximum Blue-allowed sets on M,
//   3. of those, keep the moves that lie in the most maximum Red-allowed sets on M,
// and pick any move that is left. A set X of uncoloured edges is allowed for a colour when X plus
// that colour's edges contains no triangle.

import { type Board, closesTriangle, hasTriangle } from './sim.ts';

export interface StrategyOptions {
  /** apply rule 2 (default true) */
  rule2?: boolean;
  /** apply rule 3 (default true) */
  rule3?: boolean;
  /** restrict everything to the mini-board (default true); false = use the whole K6 */
  miniBoard?: boolean;
}

/** vertex mask of the vertices touched by a set of edges */
export function touched(b: Board, edges: number): number {
  let v = 0;
  for (let e = 0; e < b.E; e++) if (edges & (1 << e)) v |= (1 << b.edges[e][0]) | (1 << b.edges[e][1]);
  return v;
}

/** edge mask of the complete subgraph on a vertex mask */
export function spanned(b: Board, verts: number): number {
  let m = 0;
  for (let e = 0; e < b.E; e++) {
    const [u, v] = b.edges[e];
    if (verts & (1 << u) && verts & (1 << v)) m |= 1 << e;
  }
  return m;
}

/** uncoloured edges inside `within` that Blue may take without closing a blue triangle */
export function allowedMoves(b: Board, mine: number, free: number, within: number): number {
  let out = 0;
  for (let f = free & within; f; f &= f - 1) {
    const e = 31 - Math.clz32(f & -f);
    if (!closesTriangle(b, mine, e)) out |= 1 << e;
  }
  return out;
}

/**
 * Every mini-board of a position, as vertex masks: the complete subgraphs, minimal under inclusion,
 * that contain all coloured edges and at least one Blue-allowed move. Found by brute force over
 * all 2^n vertex sets, so that the "unique up to isomorphism" remark is checked, not assumed.
 */
export function miniBoards(b: Board, red: number, blue: number): number[] {
  const coloured = red | blue;
  const free = ((1 << b.E) - 1) & ~coloured;
  const ok: number[] = [];
  for (let vs = 0; vs < 1 << b.n; vs++) {
    const em = spanned(b, vs);
    if ((em & coloured) !== coloured) continue;
    if (allowedMoves(b, blue, free, em) === 0) continue;
    ok.push(vs);
  }
  return ok.filter((vs) => !ok.some((w) => w !== vs && (w & vs) === w));
}

/**
 * For the allowed sets of one colour on the edge set `cand` (uncoloured edges of M):
 * the maximum size and, per edge, how many maximum allowed sets contain it.
 */
export function maximumAllowedSets(
  b: Board,
  mine: number,
  cand: number,
): { size: number; sets: number; perEdge: number[] } {
  const list: number[] = [];
  for (let f = cand; f; f &= f - 1) list.push(31 - Math.clz32(f & -f));
  let size = -1, sets = 0;
  const perEdge = new Array<number>(b.E).fill(0);
  const rec = (i: number, cur: number, taken: number) => {
    // prune: even taking every remaining edge cannot reach the current maximum
    if (taken + (list.length - i) < size) return;
    if (i === list.length) {
      if (taken > size) {
        size = taken;
        sets = 0;
        perEdge.fill(0);
      }
      sets++;
      for (let f = cur & cand; f; f &= f - 1) perEdge[31 - Math.clz32(f & -f)]++;
      return;
    }
    const e = list[i];
    if (!closesTriangle(b, cur, e)) rec(i + 1, cur | (1 << e), taken + 1);
    rec(i + 1, cur, taken);
  };
  rec(0, mine, 0);
  return { size, sets, perEdge };
}

export interface StrategyStep {
  /** vertex mask of the mini-board used (all vertices when miniBoard is off) */
  board: number;
  /** Blue-allowed moves on M (rule 1) */
  rule1: number;
  /** after rule 2 */
  rule2: number;
  /** after rule 3: the moves the strategy allows */
  rule3: number;
  /** size of a maximum Blue-allowed / Red-allowed set on M */
  maxBlue: number;
  maxRed: number;
  /** per edge: number of maximum Blue-allowed / Red-allowed sets on M containing it */
  blueCount: number[];
  redCount: number[];
}

function keepBest(moves: number, score: number[]): number {
  let best = -1, out = 0;
  for (let f = moves; f; f &= f - 1) {
    const e = 31 - Math.clz32(f & -f);
    if (score[e] > best) {
      best = score[e];
      out = 0;
    }
    if (score[e] === best) out |= 1 << e;
  }
  return out;
}

/** One step of the strategy for every possible mini-board (empty array = no Blue-allowed move at all). */
export function strategySteps(b: Board, red: number, blue: number, opt: StrategyOptions = {}): StrategyStep[] {
  const { rule2 = true, rule3 = true, miniBoard = true } = opt;
  if (hasTriangle(b, red) || hasTriangle(b, blue)) throw new Error('position already decided');
  const free = ((1 << b.E) - 1) & ~(red | blue);
  const boards = miniBoard ? miniBoards(b, red, blue) : allowedMoves(b, blue, free, free) ? [(1 << b.n) - 1] : [];
  return boards.map((vs) => {
    const em = spanned(b, vs);
    const cand = free & em;
    const r1 = allowedMoves(b, blue, free, em);
    const mb = maximumAllowedSets(b, blue, cand);
    const mr = maximumAllowedSets(b, red, cand);
    const r2 = rule2 ? keepBest(r1, mb.perEdge) : r1;
    const r3 = rule3 ? keepBest(r2, mr.perEdge) : r2;
    return {
      board: vs,
      rule1: r1,
      rule2: r2,
      rule3: r3,
      maxBlue: mb.size,
      maxRed: mr.size,
      blueCount: mb.perEdge,
      redCount: mr.perEdge,
    };
  });
}

/** union over all mini-boards of the moves the strategy allows */
export function strategyMoves(b: Board, red: number, blue: number, opt: StrategyOptions = {}): number {
  let m = 0;
  for (const s of strategySteps(b, red, blue, opt)) m |= s.rule3;
  return m;
}
