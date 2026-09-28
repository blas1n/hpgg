/** Wilson score interval for a win rate, in percentage points. Returns [low, high]. */
export function wilson(wins: number, games: number, z = 1.96): [number, number] {
  if (games <= 0) return [0, 100];
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const centre = (p + z2 / (2 * games)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games))) / denom;
  return [Math.max(0, (centre - half) * 100), Math.min(100, (centre + half) * 100)];
}
