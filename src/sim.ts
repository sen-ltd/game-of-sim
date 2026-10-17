// Sim on K_n: players alternately colour an uncoloured edge, Red first; whoever completes a triangle
// in their own colour loses. On K6 a full colouring always has a monochromatic triangle (R(3,3) = 6),
// so the game cannot be drawn; on K5 and smaller it can.
//
// A position is two edge bitmasks (red, blue); the side to move follows from the counts.

export interface Board {
  n: number;
  /** number of edges, n(n-1)/2 */
  E: number;
  /** edges[e] = [u, v], u < v, in lexicographic order */
  edges: [number, number][];
  /** edgeId[u][v] = edgeId[v][u] = e */
  edgeId: number[][];
  /** every triangle as a 3-edge mask */
  triangles: number[];
  /** for edge e: masks of the other two edges of each triangle through e */
  wings: number[][];
  /** base-3 index tables: idx(red, blue) = pow3[red] + 2 * pow3[blue] */
  pow3: Int32Array;
}

export const WIN = 2;
export const DRAW = 1;
export const LOSS = 0;

export function makeBoard(n: number): Board {
  const edges: [number, number][] = [];
  const edgeId = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  for (let u = 0; u < n; u++)
    for (let v = u + 1; v < n; v++) {
      edgeId[u][v] = edgeId[v][u] = edges.length;
      edges.push([u, v]);
    }
  const E = edges.length;
  const triangles: number[] = [];
  const wings: number[][] = Array.from({ length: E }, () => []);
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++) {
        const ab = edgeId[a][b], ac = edgeId[a][c], bc = edgeId[b][c];
        triangles.push((1 << ab) | (1 << ac) | (1 << bc));
        wings[ab].push((1 << ac) | (1 << bc));
        wings[ac].push((1 << ab) | (1 << bc));
        wings[bc].push((1 << ab) | (1 << ac));
      }
  const pow3 = new Int32Array(1 << E);
  for (let m = 1; m < 1 << E; m++) {
    const low = 31 - Math.clz32(m & -m);
    pow3[m] = pow3[m & (m - 1)] + 3 ** low;
  }
  return { n, E, edges, edgeId, triangles, wings, pow3 };
}

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Would adding edge e to `mask` complete a triangle in that colour? */
export function closesTriangle(b: Board, mask: number, e: number): boolean {
  for (const w of b.wings[e]) if ((mask & w) === w) return true;
  return false;
}

export function hasTriangle(b: Board, mask: number): boolean {
  for (const t of b.triangles) if ((mask & t) === t) return true;
  return false;
}

/** true when Red (the first player) is to move */
export function redToMove(red: number, blue: number): boolean {
  return popcount(red) === popcount(blue);
}

export interface Value {
  /** WIN / DRAW / LOSS for the side to move */
  outcome: number;
  /** plies to the end with perfect play: winner fastest, loser slowest. The losing move itself counts. */
  depth: number;
}

/**
 * Perfect-play values of every position reachable from the empty board, memoised in a base-3
 * table. Code 0 = not visited; otherwise 1 + outcome * 32 + depth.
 */
export class Solver {
  readonly b: Board;
  readonly table: Uint8Array;
  visited = 0;

  constructor(b: Board) {
    this.b = b;
    this.table = new Uint8Array(3 ** b.E);
    this.solve(0, 0);
  }

  index(red: number, blue: number): number {
    return this.b.pow3[red] + 2 * this.b.pow3[blue];
  }

  /** value of a position in which nobody has completed a triangle yet */
  value(red: number, blue: number): Value {
    const code = this.solve(red, blue);
    return { outcome: (code - 1) >> 5, depth: (code - 1) & 31 };
  }

  private solve(red: number, blue: number): number {
    const idx = this.index(red, blue);
    const cached = this.table[idx];
    if (cached) return cached;
    const b = this.b;
    const full = (1 << b.E) - 1;
    const free = full & ~(red | blue);
    const redMoves = redToMove(red, blue);
    const mine = redMoves ? red : blue;
    let bestWin = 99, bestDraw = -1, bestLoss = -1;
    if (free === 0) bestDraw = 0;
    for (let f = free; f; f &= f - 1) {
      const e = 31 - Math.clz32(f & -f);
      const bit = 1 << e;
      if (closesTriangle(b, mine, e)) {
        bestLoss = Math.max(bestLoss, 1);
        continue;
      }
      const code = redMoves ? this.solve(red | bit, blue) : this.solve(red, blue | bit);
      const o = (code - 1) >> 5, d = (code - 1) & 31;
      if (o === LOSS) bestWin = Math.min(bestWin, d + 1);
      else if (o === DRAW) bestDraw = Math.max(bestDraw, d + 1);
      else bestLoss = Math.max(bestLoss, d + 1);
    }
    let code: number;
    if (bestWin < 99) code = 1 + WIN * 32 + bestWin;
    else if (bestDraw >= 0) code = 1 + DRAW * 32 + bestDraw;
    else code = 1 + LOSS * 32 + bestLoss;
    this.table[idx] = code;
    this.visited++;
    return code;
  }

  /** every legal move from a triangle-free position, valued for the side making it */
  moves(red: number, blue: number): { edge: number; outcome: number; depth: number }[] {
    const b = this.b;
    const redMoves = redToMove(red, blue);
    const mine = redMoves ? red : blue;
    const out: { edge: number; outcome: number; depth: number }[] = [];
    for (let e = 0; e < b.E; e++) {
      const bit = 1 << e;
      if ((red | blue) & bit) continue;
      if (closesTriangle(b, mine, e)) {
        out.push({ edge: e, outcome: LOSS, depth: 1 });
        continue;
      }
      const v = redMoves ? this.value(red | bit, blue) : this.value(red, blue | bit);
      out.push({ edge: e, outcome: 2 - v.outcome, depth: v.depth + 1 });
    }
    return out;
  }
}

/** Vertex permutations of K_n acting on edge masks, for canonical forms. */
export class Symmetry {
  readonly b: Board;
  /** perms[p][v] */
  readonly perms: number[][] = [];
  private lo: Int32Array[] = [];
  private hi: Int32Array[] = [];

  constructor(b: Board) {
    this.b = b;
    const rec = (p: number[], used: number) => {
      if (p.length === b.n) {
        this.perms.push(p.slice());
        return;
      }
      for (let v = 0; v < b.n; v++)
        if (!(used & (1 << v))) {
          p.push(v);
          rec(p, used | (1 << v));
          p.pop();
        }
    };
    rec([], 0);
    const loBits = Math.min(8, b.E), hiBits = b.E - loBits;
    for (const p of this.perms) {
      const img = b.edges.map(([u, v]) => b.edgeId[p[u]][p[v]]);
      const lo = new Int32Array(1 << loBits), hi = new Int32Array(1 << hiBits);
      for (let m = 1; m < lo.length; m++) {
        const low = 31 - Math.clz32(m & -m);
        lo[m] = lo[m & (m - 1)] | (1 << img[low]);
      }
      for (let m = 1; m < hi.length; m++) {
        const low = 31 - Math.clz32(m & -m);
        hi[m] = hi[m & (m - 1)] | (1 << img[low + loBits]);
      }
      this.lo.push(lo);
      this.hi.push(hi);
    }
  }

  apply(p: number, mask: number): number {
    return this.lo[p][mask & 255] | this.hi[p][mask >>> 8];
  }

  /** canonical key: lexicographically smallest (red, blue) over all relabellings */
  canonical(red: number, blue: number): number {
    const S = 2 ** this.b.E;
    let bestR = Infinity, bestB = Infinity;
    for (let p = 0; p < this.perms.length; p++) {
      const r = this.lo[p][red & 255] | this.hi[p][red >>> 8];
      if (r > bestR) continue;
      const bl = this.lo[p][blue & 255] | this.hi[p][blue >>> 8];
      if (r < bestR || bl < bestB) {
        bestR = r;
        bestB = bl;
      }
    }
    return bestR * S + bestB;
  }

  /** number of relabellings fixing the position */
  stabiliser(red: number, blue: number): number {
    let k = 0;
    for (let p = 0; p < this.perms.length; p++)
      if (this.apply(p, red) === red && this.apply(p, blue) === blue) k++;
    return k;
  }
}

export interface LevelCount {
  /** number of coloured edges */
  ply: number;
  /** triangle-free positions with this many coloured edges, labelled */
  labelled: number;
  /** the same up to isomorphism */
  classes: number;
  /** positions in which the last move just completed a triangle (game over), labelled */
  terminalLabelled: number;
  terminalClasses: number;
}

/**
 * Enumerate every position reachable in play, level by level, labelled and up to isomorphism.
 * A terminal position is one in which the move just made completed the mover's triangle.
 */
export function enumeratePositions(b: Board, sym: Symmetry): LevelCount[] {
  const S = 2 ** b.E;
  const out: LevelCount[] = [];
  // canonical representatives of the current level, with their orbit sizes
  let level = new Map<number, number>([[0, 1]]);
  let arrived = new Map<number, number>();
  for (let ply = 0; ply <= b.E; ply++) {
    let labelled = 0;
    for (const orbit of level.values()) labelled += orbit;
    const next = new Map<number, number>();
    const terminal = new Map<number, number>();
    for (const key of level.keys()) {
      const red = Math.floor(key / S), blue = key % S;
      const redMoves = redToMove(red, blue);
      const mine = redMoves ? red : blue;
      const free = (S - 1) & ~(red | blue);
      for (let f = free; f; f &= f - 1) {
        const bit = f & -f;
        const e = 31 - Math.clz32(bit);
        const nr = redMoves ? red | bit : red, nb = redMoves ? blue : blue | bit;
        const target = closesTriangle(b, mine, e) ? terminal : next;
        const c = sym.canonical(nr, nb);
        if (!target.has(c)) {
          const cr = Math.floor(c / S), cb = c % S;
          target.set(c, sym.perms.length / sym.stabiliser(cr, cb));
        }
      }
    }
    let terminalLabelled = 0;
    for (const orbit of arrived.values()) terminalLabelled += orbit;
    out.push({ ply, labelled, classes: level.size, terminalLabelled, terminalClasses: arrived.size });
    level = next;
    arrived = terminal;
  }
  return out;
}

/** edge name with vertices numbered from 1, as in the papers: "14" */
export function edgeName(b: Board, e: number): string {
  const [u, v] = b.edges[e];
  return `${u + 1}${v + 1}`;
}

export function maskNames(b: Board, mask: number): string[] {
  const out: string[] = [];
  for (let e = 0; e < b.E; e++) if (mask & (1 << e)) out.push(edgeName(b, e));
  return out;
}

/** edge mask from names like ["14", "24"] */
export function maskOf(b: Board, names: string[]): number {
  let m = 0;
  for (const s of names) m |= 1 << b.edgeId[Number(s[0]) - 1][Number(s[1]) - 1];
  return m;
}

/**
 * Burnside check of an isomorphism-class count: the number of classes of a set of labelled
 * positions closed under relabelling is the sum over its members of |stabiliser| / n!.
 */
export function classesByBurnside(sym: Symmetry, positions: Iterable<[number, number]>): number {
  let sum = 0;
  for (const [r, bl] of positions) sum += sym.stabiliser(r, bl);
  return sum / sym.perms.length;
}

/** all triangle-free positions reachable in play, from the solver's table */
export function* reachable(s: Solver): Generator<[number, number]> {
  const E = s.b.E;
  const digits = new Int8Array(E);
  for (let idx = 0; idx < s.table.length; idx++) {
    if (!s.table[idx]) continue;
    let x = idx, red = 0, blue = 0;
    for (let e = 0; e < E; e++) {
      digits[e] = x % 3;
      x = (x - digits[e]) / 3;
      if (digits[e] === 1) red |= 1 << e;
      else if (digits[e] === 2) blue |= 1 << e;
    }
    yield [red, blue];
  }
}
