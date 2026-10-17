// Share of random (r, g)-colourings of K18 with no monochromatic K4, for every class on the game
// diagonal (r = g or r = g + 1). Usage: node tools/montecarlo.mts [samplesPerClass] [seed]
// → runs/montecarlo.json
import { writeFileSync } from 'node:fs';
import { makeSampler } from '../src/montecarlo.ts';

const samples = Number(process.argv[2] ?? 1_000_000);
const seed = Number(process.argv[3] ?? 2026);
const s = makeSampler(18, seed);
const classes: { r: number; g: number; samples: number; hits: number; ms: number }[] = [];
const t0 = performance.now();
for (let t = 0; t <= s.E; t++) {
  const r = Math.ceil(t / 2), g = Math.floor(t / 2);
  const t1 = performance.now();
  const hits = s.sample(r, g, samples);
  classes.push({ r, g, samples, hits, ms: Math.round(performance.now() - t1) });
  if (t % 10 === 0 || hits === 0) console.log(`t=${t} (${r},${g}) hits ${hits}/${samples}`);
  if (hits === 0 && classes.length > 1 && classes[classes.length - 2].hits === 0) break; // shares only fall from here
}
const out = { n: 18, k: 4, seed, samples, ms: Math.round(performance.now() - t0), classes };
writeFileSync('runs/montecarlo.json', JSON.stringify(out, null, 1) + '\n');
console.log(`done in ${out.ms} ms`);
