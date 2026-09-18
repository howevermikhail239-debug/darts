import type { Match, PlayerId } from '../match/models';

export type ProbabilityEstimate = Readonly<{
  probabilities: Readonly<Record<PlayerId, number>>;
  confidence: 'low' | 'medium';
  simulations: number;
}>;
export type SeededRandom = () => number;

/** Small deterministic PRNG for reproducible local simulations and tests. */
export function seededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const defaultScores = [26, 45, 60, 81, 100] as const;
const scoreFor = (scores: readonly number[], random: SeededRandom) => scores[Math.floor(random() * scores.length)] ?? 0;

/**
 * Bounded Monte-Carlo for X01. It samples historical confirmed visit totals (or a
 * population prior), preserves turn order, and uses current remaining scores.
 * Checkout physics are deliberately not fabricated: a sampled score can only finish
 * when it lands exactly on the remainder; longer simulations resolve by position.
 */
export function x01WinProbability(
  match: Match,
  historicalVisitScores: Readonly<Record<PlayerId, readonly number[]>> = {},
  seed = 1,
  simulations = 800,
): ProbabilityEstimate | undefined {
  if (match.state.kind !== 'x01') return undefined;
  const ids = match.players;
  if (match.status === 'completed') {
    const winners = Object.fromEntries(ids.map((id) => [id, match.winnerId === id ? 100 : 0]));
    return { probabilities: winners, confidence: 'medium', simulations: 0 };
  }
  const random = seededRandom(seed);
  const wins = new Map(ids.map((id) => [id, 0]));
  const samples = new Map(
    ids.map((id) => [id, historicalVisitScores[id]?.filter((score) => score >= 0 && score <= 180) ?? []]),
  );
  for (let run = 0; run < simulations; run += 1) {
    const remaining = { ...match.state.remaining };
    let current = match.currentPlayerIndex;
    let winner: PlayerId | undefined;
    for (let turn = 0; turn < 160 && !winner; turn += 1) {
      const id = ids[current]!;
      const scored = scoreFor(samples.get(id)!.length ? samples.get(id)! : defaultScores, random);
      const next = (remaining[id] ?? 0) - scored;
      if (next === 0) winner = id;
      else if (next > 1) remaining[id] = next;
      current = (current + 1) % ids.length;
    }
    if (!winner)
      winner = ids.reduce(
        (best, id) => ((remaining[id] ?? Infinity) < (remaining[best] ?? Infinity) ? id : best),
        ids[0]!,
      );
    wins.set(winner, wins.get(winner)! + 1);
  }
  return {
    probabilities: Object.fromEntries(ids.map((id) => [id, ((wins.get(id) ?? 0) * 100) / simulations])),
    confidence: ids.every((id) => (samples.get(id)?.length ?? 0) >= 10) ? 'medium' : 'low',
    simulations,
  };
}
