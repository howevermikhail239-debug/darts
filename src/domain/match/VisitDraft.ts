import type { DartThrow } from '../darts/DartThrow';

export type DetailedVisitDraft = Readonly<{ kind?: 'detailed'; darts: readonly DartThrow[] }>;
export type AggregateVisitDraft = Readonly<{ kind: 'aggregate'; score?: number; darts: readonly DartThrow[] }>;
export type VisitDraft = DetailedVisitDraft | AggregateVisitDraft;
export const isDetailedDraft = (draft: VisitDraft): draft is DetailedVisitDraft => draft.kind !== 'aggregate';
export const draftIsEmpty = (draft: VisitDraft): boolean => isDetailedDraft(draft) ? draft.darts.length === 0 : draft.score === undefined;
export const emptyDraft = (): DetailedVisitDraft => Object.freeze({ kind: 'detailed', darts: Object.freeze([]) });
export const emptyAggregateDraft = (): AggregateVisitDraft => Object.freeze({ kind: 'aggregate', darts: Object.freeze([]) });
const freeze = (darts: readonly DartThrow[]): DetailedVisitDraft => Object.freeze({ kind: 'detailed', darts: Object.freeze([...darts]) });
export function addDraftThrow(draft: VisitDraft, dart: DartThrow): VisitDraft {
  if (!isDetailedDraft(draft)) throw new Error('Сначала переключитесь на ввод по дротикам');
  if (draft.darts.length >= 3) throw new Error('В подходе не может быть больше трёх дротиков');
  return freeze([...draft.darts, dart]);
}
export function replaceDraftThrow(draft: VisitDraft, index: number, dart: DartThrow): VisitDraft {
  if (!isDetailedDraft(draft)) throw new Error('Суммарный подход не содержит отдельных дротиков');
  if (index < 0 || index >= draft.darts.length) throw new RangeError('Нельзя заменить пустой слот');
  return freeze(draft.darts.map((item, i) => i === index ? dart : item));
}
export function removeDraftThrow(draft: VisitDraft, index?: number): VisitDraft {
  if (!isDetailedDraft(draft)) return emptyAggregateDraft();
  const target = index ?? draft.darts.length - 1;
  if (target < 0 || target >= draft.darts.length) return draft;
  return freeze(draft.darts.filter((_, i) => i !== target));
}
export const resetDraft = (kind: 'detailed' | 'aggregate' = 'detailed'): VisitDraft => kind === 'aggregate' ? emptyAggregateDraft() : emptyDraft();
export const truncateDraft = (draft: VisitDraft, length: number): VisitDraft => isDetailedDraft(draft) ? freeze(draft.darts.slice(0, length)) : draft;
export const aggregateDraft = (score: number | undefined): AggregateVisitDraft =>
  score === undefined ? emptyAggregateDraft() : Object.freeze({ kind: 'aggregate', score, darts: Object.freeze([]) });
