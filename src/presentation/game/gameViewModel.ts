import type { SessionSnapshot } from "../../application/GameSession";
import type { Match, Player, PlayerId } from "../../domain/match/models";
import { statisticsForMatch } from "../../domain/statistics/StatisticsCalculator";
import { draftIsEmpty, isDetailedDraft } from "../../domain/match/VisitDraft";
import { checkoutSuggestion, checkoutText } from "../../domain/rules/checkoutSuggestion";

export type ScoreboardRowViewModel = Readonly<{
  playerId: PlayerId;
  name: string;
  active: boolean;
  score: number;
  average: string;
  lastScore: number | "—";
  temporary: boolean;
  position: number;
  scoreRevision: string;
}>;

export type GameViewModel = Readonly<{
  match: Match;
  title: string;
  phaseLabel: string;
  currentPlayerName: string;
  currentPlayerDetail?: string;
  draftDescription?: string;
  scoreboard: readonly ScoreboardRowViewModel[];
  awaitingTieDecision: boolean;
  canCompleteDraw: boolean;
  inExtraRound: boolean;
  completed: boolean;
  abandoned: boolean;
  canConfirm: boolean;
  canAddNextDart: boolean;
  confirmLabel: string;
  draftHint: string;
  checkoutHint?: string;
  summaryEyeline: string;
  summaryTitle: string;
}>;

const displayName = (match: Match, players: readonly Player[], playerId: PlayerId): string =>
  players.find((player) => player.id === playerId)?.name ?? match.participantNames[playerId] ?? "Игрок";

export function toGameViewModel(snapshot: SessionSnapshot, players: readonly Player[], persistentPlayerIds: readonly PlayerId[] = players.map((player) => player.id)): GameViewModel {
  const match = snapshot.match;
  const stats = statisticsForMatch(match);
  const currentPlayerId = match.players[match.currentPlayerIndex]!;
  let title: string;
  let phaseLabel: string;
  let awaitingTieDecision: boolean;
  let canCompleteDraw: boolean;
  let inExtraRound: boolean;

  if (match.state.kind === "x01") {
    const phase = match.state.phase;
    title = match.state.format.kind === "limited"
      ? `${match.state.startingScore} · ${match.state.format.visitsPerPlayer} подходов`
      : `${match.state.startingScore} · до победы`;
    awaitingTieDecision = phase.kind === "awaiting_tie_break";
    canCompleteDraw = false;
    inExtraRound = phase.kind === "tie_break";
    phaseLabel = phase.kind === "tie_break"
      ? `Дополнительный подход ${phase.round}`
      : awaitingTieDecision
        ? "Ничья по минимальному остатку"
        : match.state.format.kind === "limited"
          ? `Подход ${Math.min(...Object.values(match.state.visitsCompleted)) + 1} из ${match.state.format.visitsPerPlayer}`
          : "Точный выход в 0";
  } else {
    const phase = match.state.phase;
    title = `Серия · ${match.state.visitsPerPlayer} подходов`;
    awaitingTieDecision = phase.kind === "awaiting_tie_decision";
    canCompleteDraw = awaitingTieDecision;
    inExtraRound = phase.kind === "extra_round";
    phaseLabel = phase.kind === "extra_round"
      ? `Дополнительный подход ${phase.round}`
      : awaitingTieDecision
        ? "Ничья после основных подходов"
        : `Подход ${Math.min(...Object.values(match.state.regulationCompleted)) + 1} из ${match.state.visitsPerPlayer}`;
  }

  const scoreboard = match.players.map((playerId, index): ScoreboardRowViewModel => {
    const last = match.confirmedVisits.filter((visit) => visit.playerId === playerId).at(-1);
    const score = match.state.kind === "x01"
      ? match.state.remaining[playerId]
      : match.state.totals[playerId];
    return {
      playerId,
      name: displayName(match, players, playerId),
      active: index === match.currentPlayerIndex,
      score: score ?? 0,
      average: stats[playerId]?.averagePerVisit.toFixed(1) ?? "0,0",
      lastScore: last?.awardedScore ?? "—",
      temporary: !persistentPlayerIds.includes(playerId),
      position: index,
      scoreRevision: last?.id ?? "initial",
    };
  });
  const winnerName = match.winnerId ? displayName(match, players, match.winnerId) : undefined;
  const draftDescription = draftIsEmpty(snapshot.draft)
    ? undefined
    : isDetailedDraft(snapshot.draft)
      ? `Незавершённый подход · ${snapshot.draft.darts.length}/3 дротика`
      : `Незавершённый подход · сумма ${snapshot.draft.score}`;
  const dartsRemaining = isDetailedDraft(snapshot.draft) ? 3 - snapshot.draft.darts.length : 0;
  const checkoutScore = snapshot.evaluation.remainingAfter ?? (match.state.kind === "x01" ? match.state.remaining[currentPlayerId] : undefined);
  const checkout = match.state.kind === "x01" && match.state.phase.kind === "regulation" && checkoutScore !== undefined
    ? checkoutSuggestion(checkoutScore, dartsRemaining, match.state.outRule) : undefined;

  return {
    match,
    title,
    phaseLabel,
    currentPlayerName: displayName(match, players, currentPlayerId),
    ...(match.state.kind === "x01" ? { currentPlayerDetail: `остаток: ${match.state.remaining[currentPlayerId]}` } : {}),
    ...(draftDescription ? { draftDescription } : {}),
    scoreboard,
    awaitingTieDecision,
    canCompleteDraw,
    inExtraRound,
    completed: match.status === "completed",
    abandoned: match.status === "abandoned",
    canConfirm: !awaitingTieDecision && !snapshot.isConfirming && snapshot.evaluation.status !== "in_progress" && snapshot.evaluation.status !== "invalid",
    canAddNextDart: !awaitingTieDecision && !snapshot.isConfirming && snapshot.evaluation.canAddNextDart,
    confirmLabel: snapshot.isConfirming
      ? "Сохраняем…"
      : snapshot.evaluation.status === "bust"
        ? "Подтвердить перебор"
        : `Подтвердить ${snapshot.evaluation.awardedScore}`,
    ...(checkout ? { checkoutHint: `${checkoutScore} → ${checkoutText(checkout)}` } : {}),
    draftHint: match.state.kind === "fixed_visits"
      ? "Введите все три физических дротика"
      : "Можно подтвердить после трёх дротиков или досрочного завершения",
    summaryEyeline: match.state.kind === "x01" ? String(match.state.startingScore) : "Серия завершена",
    summaryTitle: winnerName
      ? `${winnerName} победил${winnerName.endsWith("а") ? "а" : ""}`
      : "Ничья",
  };
}
