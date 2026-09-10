import type { Match, PlayerId } from "./models";

export type MatchSetup =
  | Readonly<{
      mode: "x01";
      startingScore?: 301 | 501 | 701;
      outRule?: 'straight' | 'double';
      format:
        | Readonly<{ kind: "unlimited" }>
        | Readonly<{ kind: "limited"; visitsPerPlayer: number }>;
      startingPlayerIndex: number;
    }>
  | Readonly<{
      mode: "fixed_visits";
      visitsPerPlayer: number;
      startingPlayerIndex: number;
    }>;

export function createMatch(
  id: string,
  playerIds: readonly PlayerId[],
  setup: MatchSetup,
  now: string,
  participantNames: Readonly<Record<PlayerId, string>> = Object.fromEntries(
    playerIds.map((playerId, index) => [playerId, `Игрок ${index + 1}`]),
  ),
): Match {
  if (playerIds.length < 2 || new Set(playerIds).size !== playerIds.length)
    throw new Error("Матчу нужны как минимум два разных игрока");
  if (
    !Number.isInteger(setup.startingPlayerIndex) ||
    setup.startingPlayerIndex < 0 ||
    setup.startingPlayerIndex >= playerIds.length
  )
    throw new Error("Некорректный начинающий");
  if (setup.mode === "x01") {
    if (
      setup.format.kind === "limited" &&
      (!Number.isInteger(setup.format.visitsPerPlayer) ||
        setup.format.visitsPerPlayer < 1 ||
        setup.format.visitsPerPlayer > 999)
    )
      throw new Error("Количество подходов должно быть от 1 до 999");
    const startingScore = setup.startingScore ?? 501;
    const state: Match["state"] = {
      kind: "x01",
      startingScore,
      outRule: setup.outRule ?? 'straight',
      format: setup.format,
      remaining: Object.fromEntries(playerIds.map((p) => [p, startingScore])),
      visitsCompleted: Object.fromEntries(playerIds.map((p) => [p, 0])),
      phase: { kind: "regulation" },
    };
    return Object.freeze({
      id,
      createdAt: now,
      status: "in_progress",
      players: [...playerIds],
      participantNames: { ...participantNames },
      startingPlayerIndex: setup.startingPlayerIndex,
      currentPlayerIndex: setup.startingPlayerIndex,
      confirmedVisits: [],
      state,
    });
  }
  if (
    !Number.isInteger(setup.visitsPerPlayer) ||
    setup.visitsPerPlayer < 1 ||
    setup.visitsPerPlayer > 999
  )
    throw new Error("Количество подходов должно быть от 1 до 999");
  const state: Match["state"] = {
    kind: "fixed_visits",
    visitsPerPlayer: setup.visitsPerPlayer,
    totals: Object.fromEntries(playerIds.map((p) => [p, 0])),
    regulationCompleted: Object.fromEntries(playerIds.map((p) => [p, 0])),
    extraRoundsCompleted: 0,
    phase: { kind: "regulation" },
  };
  return Object.freeze({
    id,
    createdAt: now,
    status: "in_progress",
    players: [...playerIds],
    participantNames: { ...participantNames },
    startingPlayerIndex: setup.startingPlayerIndex,
    currentPlayerIndex: setup.startingPlayerIndex,
    confirmedVisits: [],
    state,
  });
}
