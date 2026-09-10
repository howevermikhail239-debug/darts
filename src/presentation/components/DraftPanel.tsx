import { notationOf, scoreOf } from '../../domain/darts/DartThrow';
import type { SessionSnapshot } from '../../application/GameSession';
import { t } from '../strings';
import { isDetailedDraft } from '../../domain/match/VisitDraft';
type Props={snapshot:SessionSnapshot;hint:string;canConfirm:boolean;confirmLabel:string;selected:number|undefined;onSelect:(index:number)=>void;onRemove:()=>void;onReset:()=>void;onConfirm:()=>void};
export function DraftPanel({snapshot,hint,canConfirm,confirmLabel,selected,onSelect,onRemove,onReset,onConfirm}:Props){const {draft,evaluation,isConfirming}=snapshot;const ready=evaluation.status!=='in_progress'&&evaluation.status!=='invalid';return <section className="draft-panel">
  <div className="section-heading"><h2>{t.currentVisit}</h2>{selected!==undefined?<span>{t.replace} {selected+1}</span>:null}</div>
  {isDetailedDraft(draft)?<div className="dart-slots">{[0,1,2].map(i=>{const dart=draft.darts[i];return <button key={i} className={`${dart?'filled':''} ${selected===i?'selected':''}`} onClick={()=>dart&&onSelect(i)} disabled={isConfirming} aria-label={dart?`${t.dart} ${i+1}: ${notationOf(dart)}, заменить`:`${t.dart} ${i+1}: пусто`}><small>{t.dart} {i+1}</small><b>{dart?notationOf(dart):'—'}</b><span>{dart?scoreOf(dart):'пусто'}</span></button>})}</div>:<div className="aggregate-summary"><small>Сумма полного подхода</small><strong>{draft.score ?? '—'}</strong><span>3 физических дротика</span></div>}
  {snapshot.notice?<div className="notice" role="status">{snapshot.notice}</div>:null}
  <div className={`evaluation ${evaluation.status==='bust'?'danger':''}`}><div><small>{evaluation.status==='bust'?t.bust:'Сумма подхода'}</small><strong>{evaluation.status==='bust'?'0':evaluation.rawScore}</strong></div>{evaluation.remainingAfter!==undefined?<div><small>После подтверждения</small><strong>{evaluation.remainingAfter}</strong></div>:null}</div>
  {evaluation.reason?<p className="reason">{evaluation.reason}. Зачётные очки: 0.</p>:null}
  <div className="draft-actions"><button className="secondary" onClick={onRemove} disabled={(isDetailedDraft(draft)?draft.darts.length===0:draft.score===undefined)||isConfirming}>{isDetailedDraft(draft)?'Удалить последний':'Очистить сумму'}</button><button className="secondary" onClick={onReset} disabled={(isDetailedDraft(draft)?draft.darts.length===0:draft.score===undefined)||isConfirming}>{t.reset}</button><button className="primary" onClick={onConfirm} disabled={!canConfirm}>{confirmLabel}</button></div>
  {!ready?<p className="hint">{hint}</p>:null}
  </section>}
