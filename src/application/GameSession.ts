import {
  addDraftThrow,
  emptyDraft,
  removeDraftThrow,
  replaceDraftThrow,
  resetDraft,
  truncateDraft,
  aggregateDraft,
  draftIsEmpty,
  isDetailedDraft,
  type VisitDraft,
} from "../domain/match/VisitDraft";
import {
  currentPlayerId,
  visitContext,
  type Match,
  type Visit,
} from "../domain/match/models";
import type { DartThrow } from "../domain/darts/DartThrow";
import type { DraftEvaluation } from "../domain/rules/GameRules";
import { rulesFor } from "../domain/rules/rulesFor";
import type {
  ActiveMatchRecord,
  ActiveVisitDraft,
  MatchRepository,
} from "./ports/repositories";

export type IdGenerator = () => string;
export type Clock = () => string;
export type SessionSnapshot = Readonly<{
  match: Match;
  draft: VisitDraft;
  evaluation: DraftEvaluation;
  isConfirming: boolean;
  notice?: string;
  undoVisit?: Visit;
}>;
const MAX_UNDO_CHECKPOINTS = 20;
export class GameSession {
  private draft: VisitDraft = emptyDraft();
  private checkpoints: Match[] = [];
  private confirming = false;
  private notice: string | undefined;
  constructor(
    private match: Match,
    private readonly repository: MatchRepository,
    private readonly id: IdGenerator,
    private readonly now: Clock,
    previous?: Match,
    restoredDraft?: ActiveVisitDraft,
    draftRecovery?: ActiveMatchRecord["draftRecovery"],
    private readonly companyToken?: string,
  ) {
    if (previous) this.checkpoints.push(previous);
    if (restoredDraft) {
      if (restoredDraft.playerId !== currentPlayerId(match))
        throw new Error("Сохранённый подход не соответствует текущему игроку");
      this.draft = restoredDraft.draft;
    }
    if (draftRecovery === "discarded_corrupt")
      this.notice = "Повреждённый незавершённый подход сброшен. Сам матч восстановлен.";
  }
  snapshot(): SessionSnapshot {
    const value = {
      match: this.match,
      draft: this.draft,
      evaluation: rulesFor(this.match).evaluateDraft(this.draft, this.match),
      isConfirming: this.confirming,
    };
    const undoVisit = this.match.confirmedVisits.at(-1);
    const withUndo = this.checkpoints.length && undoVisit ? { ...value, undoVisit } : value;
    return this.notice ? { ...withUndo, notice: this.notice } : withUndo;
  }
  async record(dart: DartThrow, replaceIndex?: number): Promise<SessionSnapshot> {
    this.ensureMutable();
    this.ensureInput();
    const changed =
      replaceIndex === undefined
        ? addDraftThrow(this.draft, dart)
        : replaceDraftThrow(this.draft, replaceIndex, dart);
    const { draft, notice } = this.normalize(changed);
    return this.persistDraft(draft, notice);
  }
  async remove(index?: number): Promise<SessionSnapshot> {
    this.ensureMutable();
    this.ensureInput();
    return this.persistDraft(removeDraftThrow(this.draft, index));
  }
  async reset(): Promise<SessionSnapshot> {
    this.ensureMutable();
    return this.persistDraft(resetDraft(isDetailedDraft(this.draft) ? 'detailed' : 'aggregate'));
  }
  async setInputMode(kind: 'detailed' | 'aggregate', discard = false): Promise<SessionSnapshot> {
    this.ensureMutable();
    if (!draftIsEmpty(this.draft) && !discard) throw new Error('Сначала сбросьте незавершённый подход');
    return this.persistDraft(resetDraft(kind));
  }
  async setAggregateScore(score: number | undefined): Promise<SessionSnapshot> {
    this.ensureMutable();
    if (isDetailedDraft(this.draft)) throw new Error('Сначала переключитесь на быстрый ввод');
    return this.persistDraft(aggregateDraft(score));
  }
  private normalize(draft: VisitDraft): Readonly<{ draft: VisitDraft; notice?: string }> {
    const evaluation = rulesFor(this.match).evaluateDraft(draft, this.match);
    return isDetailedDraft(draft) && evaluation.validDartCount < draft.darts.length
      ? {
          draft: truncateDraft(draft, evaluation.validDartCount),
          notice: "Поздние дротики удалены: подход завершился раньше."
        }
      : { draft };
  }
  private activeRecord(
    current: Match = this.match,
    draft: VisitDraft = this.draft,
    previous: Match | undefined = this.checkpoints.at(-1),
  ): ActiveMatchRecord {
    const base = {
      current,
      draft: { playerId: currentPlayerId(current), draft },
      ...(this.companyToken ? { companyToken: this.companyToken } : {}),
    };
    return previous ? { ...base, previous } : base;
  }
  private async persistDraft(draft: VisitDraft, notice?: string): Promise<SessionSnapshot> {
    this.confirming = true;
    try {
      await this.repository.saveActive(this.activeRecord(this.match, draft));
      this.draft = draft;
      this.notice = notice;
    } finally {
      this.confirming = false;
    }
    return this.snapshot();
  }
  private ensureInput(): void {
    if (this.match.status !== "in_progress") throw new Error("Матч завершён");
    if (
      (this.match.state.kind === "fixed_visits" &&
        this.match.state.phase.kind === "awaiting_tie_decision") ||
      (this.match.state.kind === "x01" &&
        this.match.state.phase.kind === "awaiting_tie_break")
    )
      throw new Error("Сначала выберите результат ничьей");
  }
  private ensureMutable(): void {
    if (this.confirming) throw new Error("Подтверждение уже выполняется");
  }
  async confirm(): Promise<SessionSnapshot> {
    if (this.confirming) return this.snapshot();
    this.ensureInput();
    const rules = rulesFor(this.match);
    const evaluation = rules.evaluateDraft(this.draft, this.match);
    if (evaluation.status === "in_progress" || evaluation.status === 'invalid')
      throw new Error(
        evaluation.reason ?? (this.match.state.kind === "fixed_visits"
          ? "Введите ровно три дротика"
          : "Введите дротик"),
      );
    this.confirming = true;
    try {
      const previous = this.match;
      const timestamp = this.now();
      const before = visitContext(previous);
      const playerId = currentPlayerId(previous);
      const provisionalResult =
        evaluation.status === "bust"
          ? "bust"
          : evaluation.status === "match_won"
              ? "match_won"
              : "scored";
      const common = {
        id: this.id(),
        matchId: previous.id,
        playerId,
        visitIndex: previous.confirmedVisits.length,
        physicalDartsUsed: evaluation.physicalDartsUsed,
        rawScore: evaluation.rawScore,
        awardedScore: evaluation.awardedScore,
        before,
        // `after` is replaced with the context of the authoritative rules transition below.
        after: before,
        result: provisionalResult,
        timestamp,
      } as const;
      const provisionalVisit: Visit = isDetailedDraft(this.draft)
        ? Object.freeze({ ...common, inputKind: 'detailed' as const, darts: Object.freeze([...this.draft.darts]) })
        : Object.freeze({ ...common, inputKind: 'aggregate' as const, aggregateScore: evaluation.rawScore });
      const applied = rules.applyConfirmedVisit(provisionalVisit, previous);
      // The rules own the authoritative result of the visit they applied (a checkout in the
      // limited format, for example, stays `tie_pending` until its round is finished).
      const visit: Visit = Object.freeze({
        ...(applied.confirmedVisits.at(-1) ?? provisionalVisit),
        after: visitContext(applied),
      });
      const next: Match = {
        ...applied,
        confirmedVisits: [...applied.confirmedVisits.slice(0, -1), visit],
      };
      const nextDraft = resetDraft(isDetailedDraft(this.draft) ? 'detailed' : 'aggregate');
      await this.repository.saveActive(
        this.activeRecord(next, nextDraft, previous),
      );
      this.pushCheckpoint(previous);
      this.match = next;
      this.draft = nextDraft;
      this.notice = undefined;
    } finally {
      this.confirming = false;
    }
    return this.snapshot();
  }
  async undo(discardDraft = false): Promise<SessionSnapshot> {
    this.ensureMutable();
    if (!draftIsEmpty(this.draft) && !discardDraft)
      throw new Error("Сначала сбросьте незавершённый подход");
    const previous = this.checkpoints.at(-1);
    if (!previous) throw new Error("Нет подхода для отмены");
    const fallback = this.checkpoints.at(-2);
    await this.repository.saveActive(
      this.activeRecord(previous, emptyDraft(), fallback),
    );
    this.checkpoints.pop();
    this.match = previous;
    this.draft = emptyDraft();
    this.notice = "Предыдущий подход отменён.";
    return this.snapshot();
  }
  private pushCheckpoint(previous: Match): void {
    this.checkpoints.push(previous);
    if (this.checkpoints.length > MAX_UNDO_CHECKPOINTS) this.checkpoints.shift();
  }
  async extraRound(): Promise<SessionSnapshot> {
    this.ensureMutable();
    const previous = this.match;
    const next = rulesFor(this.match).startExtraRound(this.match);
    await this.repository.saveActive(this.activeRecord(next, emptyDraft(), previous));
    this.pushCheckpoint(previous);
    this.match = next;
    this.draft = emptyDraft();
    return this.snapshot();
  }
  async completeDraw(): Promise<SessionSnapshot> {
    this.ensureMutable();
    const previous = this.match;
    const next = rulesFor(this.match).completeDraw(this.match, this.now());
    await this.repository.saveActive(this.activeRecord(next, emptyDraft(), previous));
    this.pushCheckpoint(previous);
    this.match = next;
    this.draft = emptyDraft();
    return this.snapshot();
  }
  async abandon(): Promise<Match> {
    this.ensureMutable();
    // Abandoning a match that already has a result would erase that result: archive it as it is.
    if (this.match.status === "completed") return this.finalize();
    if (this.match.status === "abandoned") return this.match;
    const next: Match = {
      ...this.match,
      status: "abandoned",
      completedAt: this.now(),
    };
    await this.repository.archiveAndClearActive(next);
    this.match = next;
    return this.match;
  }
  async finalize(): Promise<Match> {
    this.ensureMutable();
    if (this.match.status !== "completed")
      throw new Error("Матч ещё не завершён");
    await this.repository.archiveAndClearActive(this.match);
    this.checkpoints = [];
    return this.match;
  }
}
