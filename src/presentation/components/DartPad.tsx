import type { Multiplier } from '../../domain/darts/DartThrow';
import { t } from '../strings';
type Props={multiplier:Multiplier;disabled:boolean;onMultiplier:(m:Multiplier)=>void;onNumber:(n:number)=>void;onBull:(kind:'outer'|'bull'|'miss')=>void};
export function DartPad({multiplier,disabled,onMultiplier,onNumber,onBull}:Props){return <section className="dart-pad" aria-label="Панель ввода попадания">
  <div className="multipliers">{([1,2,3] as const).map(m=><button key={m} className={multiplier===m?'selected':''} aria-pressed={multiplier===m} onClick={()=>onMultiplier(m)} disabled={disabled}>×{m}</button>)}</div>
  <div className="numbers">{Array.from({length:20},(_,i)=>i+1).map(n=><button key={n} onClick={()=>onNumber(n)} disabled={disabled} aria-label={`Сектор ${n}, множитель ${multiplier}`}><span>{n}</span>{multiplier>1?<small aria-hidden="true">{n*multiplier}</small>:null}</button>)}</div>
  <div className="special"><button onClick={()=>onBull('outer')} disabled={disabled}>25</button><button onClick={()=>onBull('bull')} disabled={disabled}>50</button><button onClick={()=>onBull('miss')} disabled={disabled}>{t.miss}</button></div>
</section>}
