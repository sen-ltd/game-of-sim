// Monte Carlo estimate of the number of legal positions of the R(4,4) game ("Sim_4"): K18, players
// avoid a K4 in their own colour. Slany (1999) multiplied, for every (r, g) on the game diagonal,
// the Pólya count of (r, g)-colourings up to isomorphism by the share of uniformly random labelled
// (r, g)-colourings with no monochromatic K4 ("method 2").

/** mulberry32: small, fast, seedable */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sampler {
  n: number;
  E: number;
  /** probability estimate data for one (r, g) class: hits = colourings with no monochromatic K_k */
  sample(r: number, g: number, samples: number): number;
}

/** does the graph given by adjacency masks contain a K4? */
export function hasK4(adj: Int32Array, n: number): boolean {
  for (let u = 0; u < n; u++) {
    let nu = adj[u] & ~((2 << u) - 1); // neighbours above u
    while (nu) {
      const v = 31 - Math.clz32(nu & -nu);
      nu &= nu - 1;
      let c = adj[u] & adj[v] & ~((2 << v) - 1);
      while (c) {
        const w = 31 - Math.clz32(c & -c);
        c &= c - 1;
        if (adj[w] & c) return true; // c now holds common neighbours above w
      }
    }
  }
  return false;
}

export function makeSampler(n: number, seed: number): Sampler {
  const E = (n * (n - 1)) / 2;
  const eu = new Int32Array(E), ev = new Int32Array(E);
  let k = 0;
  for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) (eu[k] = u), (ev[k] = v), k++;
  const order = new Int32Array(E);
  const red = new Int32Array(n), blue = new Int32Array(n);
  const rand = rng(seed);
  return {
    n,
    E,
    sample(r: number, g: number, samples: number): number {
      let hits = 0;
      for (let i = 0; i < E; i++) order[i] = i;
      for (let s = 0; s < samples; s++) {
        // partial Fisher-Yates: the first r + g entries are a uniform random ordered subset
        for (let i = 0; i < r + g; i++) {
          const j = i + Math.floor(rand() * (E - i));
          const t = order[i];
          order[i] = order[j];
          order[j] = t;
        }
        red.fill(0);
        blue.fill(0);
        for (let i = 0; i < r; i++) {
          const e = order[i];
          red[eu[e]] |= 1 << ev[e];
          red[ev[e]] |= 1 << eu[e];
        }
        for (let i = r; i < r + g; i++) {
          const e = order[i];
          blue[eu[e]] |= 1 << ev[e];
          blue[ev[e]] |= 1 << eu[e];
        }
        if (!hasK4(red, n) && !hasK4(blue, n)) hits++;
      }
      return hits;
    },
  };
}
