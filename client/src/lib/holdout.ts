/** FNV-1a 32-bit hash: fast, deterministic, good enough for shuffling IDs. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface HoldoutSplit {
  emailed: number[];
  holdout: number[];
}

/**
 * Mark exactly round(percent% × group size) customers as "don't email". Customers are ranked by a
 * seeded hash of their ID, so the split is stable across re-renders and independent of row order.
 * `members` are indexes; `ids` maps an index to its customer ID.
 */
export function splitHoldout(
  members: number[],
  ids: (i: number) => string,
  percent: number,
  seed: number,
): HoldoutSplit {
  const k = Math.round((members.length * Math.min(100, Math.max(0, percent))) / 100);
  if (k === 0) return { emailed: [...members], holdout: [] };
  const ranked = members
    .map((i) => ({ i, h: hash32(`${seed}:${ids(i)}`) }))
    .sort((a, b) => a.h - b.h || (ids(a.i) < ids(b.i) ? -1 : 1));
  const held = new Set(ranked.slice(0, k).map((r) => r.i));
  return {
    emailed: members.filter((i) => !held.has(i)),
    holdout: members.filter((i) => held.has(i)),
  };
}
