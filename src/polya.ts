// Pólya counting of red/blue partial colourings of K_n up to relabelling the vertices.
//
// A vertex permutation with cycle type (m_1, …, m_n) moves the C(n,2) edges in cycles; a colouring
// is fixed by the permutation exactly when every edge cycle is one colour (or uncoloured). An edge
// cycle of length l therefore contributes the factor (1 + x^l + y^l), and Burnside's lemma averages
// the product over all n! permutations. [x^r y^g] of the result is the number of colourings with r
// red and g blue edges up to isomorphism.

function factorial(n: number): bigint {
  let f = 1n;
  for (let i = 2; i <= n; i++) f *= BigInt(i);
  return f;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** All partitions of n as multiplicity arrays m[1..n]. */
export function partitions(n: number): number[][] {
  const out: number[][] = [];
  const m = new Array(n + 1).fill(0);
  const rec = (rest: number, maxPart: number) => {
    if (rest === 0) {
      out.push(m.slice());
      return;
    }
    for (let k = Math.min(rest, maxPart); k >= 1; k--) {
      m[k]++;
      rec(rest - k, k);
      m[k]--;
    }
  };
  rec(n, n);
  return out;
}

/** Lengths of the edge cycles induced by a vertex permutation of cycle type m. */
export function edgeCycles(m: number[]): number[] {
  const n = m.length - 1;
  const out: number[] = [];
  for (let k = 1; k <= n; k++) {
    if (!m[k]) continue;
    // edges inside one vertex cycle of length k
    for (let c = 0; c < m[k]; c++) {
      if (k % 2 === 1) for (let i = 0; i < (k - 1) / 2; i++) out.push(k);
      else {
        for (let i = 0; i < (k - 2) / 2; i++) out.push(k);
        out.push(k / 2);
      }
    }
    // edges between two different vertex cycles of length k
    const pairs = (m[k] * (m[k] - 1)) / 2;
    for (let p = 0; p < pairs * k; p++) out.push(k);
    // edges between a cycle of length k and one of length j > k
    for (let j = k + 1; j <= n; j++) {
      if (!m[j]) continue;
      const g = gcd(k, j);
      const l = (k * j) / g;
      for (let p = 0; p < m[k] * m[j] * g; p++) out.push(l);
    }
  }
  return out;
}

/** Number of permutations of cycle type m: n! / prod k^{m_k} m_k!. */
export function classSize(m: number[]): bigint {
  const n = m.length - 1;
  let d = 1n;
  for (let k = 1; k <= n; k++) d *= BigInt(k) ** BigInt(m[k]) * factorial(m[k]);
  return factorial(n) / d;
}

export interface PolyaTable {
  n: number;
  edges: number;
  /** count[r][g], r + g <= edges, as decimal strings */
  count: bigint[][];
}

/**
 * count[r][g] = number of colourings of K_n with r red and g blue edges (the rest uncoloured),
 * up to vertex relabelling. Exact (BigInt).
 */
export function polyaTable(n: number): PolyaTable {
  const E = (n * (n - 1)) / 2;
  const W = E + 1;
  const total: bigint[] = new Array(W * W).fill(0n);
  const P: bigint[] = new Array(W * W).fill(0n);
  for (const m of partitions(n)) {
    P.fill(0n);
    P[0] = 1n;
    let deg = 0;
    for (const l of edgeCycles(m)) {
      deg += l;
      const top = Math.min(deg, E);
      // multiply in place by (1 + x^l + y^l); descending so sources are still the old values
      for (let r = top; r >= 0; r--) {
        const gMax = Math.min(top - r, E - r);
        for (let g = gMax; g >= 0; g--) {
          let v = P[r * W + g];
          if (r >= l) v += P[(r - l) * W + g];
          if (g >= l) v += P[r * W + g - l];
          P[r * W + g] = v;
        }
      }
    }
    const c = classSize(m);
    for (let r = 0; r <= E; r++)
      for (let g = 0; r + g <= E; g++) if (P[r * W + g]) total[r * W + g] += c * P[r * W + g];
  }
  const nf = factorial(n);
  const count: bigint[][] = [];
  for (let r = 0; r <= E; r++) {
    const row: bigint[] = [];
    for (let g = 0; r + g <= E; g++) {
      const t = total[r * W + g];
      if (t % nf !== 0n) throw new Error(`Burnside sum not divisible at (${r},${g})`);
      row.push(t / nf);
    }
    count.push(row);
  }
  return { n, edges: E, count };
}

/** Sum of count[r][g] over the "game" diagonal r = g or r = g + 1 (red moves first). */
export function diagonalSum(t: PolyaTable): bigint {
  let s = 0n;
  for (let g = 0; 2 * g <= t.edges; g++) {
    s += t.count[g][g];
    if (2 * g + 1 <= t.edges) s += t.count[g + 1][g];
  }
  return s;
}
