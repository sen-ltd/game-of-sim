// Exact Pólya counts of partial red/blue colourings of K_n up to isomorphism.
// Usage: node tools/polya.mts [n ...]   (default: 3 4 5 6 18) → runs/polya-<n>.json
import { writeFileSync } from 'node:fs';
import { polyaTable, diagonalSum } from '../src/polya.ts';

const ns = process.argv.slice(2).map(Number);
for (const n of ns.length ? ns : [3, 4, 5, 6, 18]) {
  const t0 = performance.now();
  const t = polyaTable(n);
  const ms = Math.round(performance.now() - t0);
  let all = 0n;
  for (const row of t.count) for (const c of row) all += c;
  const diag: { r: number; g: number; count: string }[] = [];
  for (let g = 0; 2 * g <= t.edges; g++) {
    diag.push({ r: g, g, count: t.count[g][g].toString() });
    if (2 * g + 1 <= t.edges) diag.push({ r: g + 1, g, count: t.count[g + 1][g].toString() });
  }
  const out = {
    n,
    edges: t.edges,
    ms,
    allColourings: all.toString(),
    gameDiagonal: diagonalSum(t).toString(),
    diag,
  };
  writeFileSync(`runs/polya-${n}.json`, JSON.stringify(out, null, 1) + '\n');
  console.log(`K${n}: ${ms} ms, all ${all}, r=g or g+1: ${out.gameDiagonal}`);
}
