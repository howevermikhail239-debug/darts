import { useState } from "react";
import type { MatchSetup } from "../../domain/match/createMatch";
import type { MatchParticipantInput } from "../../application/StartMatch";
import type { Player, PlayerId } from "../../domain/match/models";
import { t } from "../strings";

export type SetupParticipant = MatchParticipantInput;
type ParticipantDraft = { name: string; playerId?: PlayerId };
type Props = { saved: readonly Player[]; onStart: (participants: readonly SetupParticipant[], setup: MatchSetup) => Promise<void>; onHistory: () => void; onStatistics: () => void; company?: { name: string } | undefined; onCreateCompany?: (name: string) => Promise<void>; onAddSharedPlayer?: (name: string) => Promise<void>; onLeaveCompany?: () => void; onRetry?: () => Promise<void>; syncNote?: string | undefined };
const defaultParticipant = (index: number): ParticipantDraft => ({ name: `Игрок ${index + 1}` });

export function SetupPage({ saved, onStart, onHistory, onStatistics, company, onCreateCompany, onAddSharedPlayer, onLeaveCompany, onRetry, syncNote }: Props) {
  const [participants, setParticipants] = useState<ParticipantDraft[]>([defaultParticipant(0), defaultParticipant(1)]);
  const [mode, setMode] = useState<"x01" | "fixed_visits">("x01");
  const [x01Format, setX01Format] = useState<"unlimited" | "limited">("unlimited");
  const [startingScore, setStartingScore] = useState<301 | 501 | 701>(501);
  const [outRule, setOutRule] = useState<'straight' | 'double'>('straight');
  const [visits, setVisits] = useState(20);
  const [custom, setCustom] = useState(false);
  const [starter, setStarter] = useState<number | "random">(0);
  const [busy, setBusy] = useState(false);
  const selectedIds = participants.flatMap((participant) => participant.playerId ? [participant.playerId] : []);
  const participantsValid = participants.every((participant) => participant.name.trim()) && new Set(selectedIds).size === selectedIds.length;
  const visitsValid = Number.isInteger(visits) && visits >= 1 && visits <= 999;
  const visitsRequired = mode === "fixed_visits" || x01Format === "limited";
  const valid = participantsValid && (!visitsRequired || visitsValid);
  const start = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const startingPlayerIndex = starter === "random" ? Math.floor(Math.random() * participants.length) : Math.min(starter, participants.length - 1);
      const clean = participants.map(({ name, playerId }) => ({ name: name.trim(), ...(playerId ? { playerId } : {}) }));
      await onStart(clean, mode === "x01" ? { mode, startingScore, outRule, format: x01Format === "unlimited" ? { kind: "unlimited" } : { kind: "limited", visitsPerPlayer: visits }, startingPlayerIndex } : { mode, visitsPerPlayer: visits, startingPlayerIndex });
    } finally { setBusy(false); }
  };
  const [companyName, setCompanyName] = useState(''); const [playerName, setPlayerName] = useState(''); const [creatingCompany, setCreatingCompany] = useState(false);
  return <main className="setup-page"><header className="brand"><div className="brand-mark">◎</div><div><h1>{t.newGame}</h1><p>От двух до восьми игроков. Каждый дротик учтён.</p></div></header>{company ? <section className="company-context" aria-label="Компания"><b>Компания{company.name ? ` · ${company.name}` : ''}</b><span role="status">{syncNote ?? 'Все матчи синхронизированы'}</span><button className="link-button" onClick={()=>navigator.clipboard?.writeText(location.href)}>Пригласить: скопировать ссылку</button>{syncNote ? <button className="link-button" onClick={()=>void onRetry?.()}>Повторить</button> : null}<button className="link-button" onClick={onLeaveCompany}>Это устройство</button><label>Добавить игрока компании<input value={playerName} maxLength={80} onChange={e=>setPlayerName(e.target.value)}/></label><button className="secondary" disabled={!playerName.trim()} onClick={()=>void onAddSharedPlayer?.(playerName).then(()=>setPlayerName(''))}>Добавить игрока</button></section> : <section className="company-context"><b>Играете локально на этом устройстве</b>{creatingCompany ? <><label>Название компании (необязательно)<input value={companyName} maxLength={80} onChange={e=>setCompanyName(e.target.value)}/></label><button className="secondary" onClick={()=>void onCreateCompany?.(companyName)}>Создать</button></> : <button className="secondary" onClick={()=>setCreatingCompany(true)}>Создать компанию</button>}</section>}<section className="setup-form">
    <div className="player-fields">{participants.map((participant, index) => <label key={index}>Игрок {index + 1}<span className="input-row"><input aria-label={`Имя игрока ${index + 1}`} value={participant.name} onChange={(event) => setParticipants((current) => current.map((item, itemIndex) => itemIndex === index ? { name: event.target.value } : item))} maxLength={28}/>{participants.length > 2 ? <button type="button" className="remove-player" onClick={() => { setParticipants((current) => current.filter((_, itemIndex) => itemIndex !== index)); setStarter(0); }} aria-label={`Удалить игрока ${index + 1}`}>×</button> : null}</span>{saved.length ? <select aria-label={`Выбрать сохранённого игрока ${index + 1}`} value={participant.playerId ?? ""} onChange={(event) => { const player = saved.find((item) => item.id === event.target.value); if (player) setParticipants((current) => current.map((item, itemIndex) => itemIndex === index ? { name: player.name, playerId: player.id } : item)); }}><option value="">Временный игрок</option>{saved.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select> : null}</label>)}</div>
    {participants.length < 8 ? <button type="button" className="secondary add-player" onClick={() => setParticipants((current) => [...current, defaultParticipant(current.length)])}>+ Добавить игрока</button> : null}{!participantsValid ? <p className="reason">Имена должны быть заполнены, а сохранённый профиль нельзя выбрать дважды.</p> : null}{visitsRequired && !visitsValid ? <p className="reason">Количество подходов должно быть от 1 до 999.</p> : null}
    <fieldset><legend>{t.mode}</legend><div className="segments"><button type="button" className={mode === "x01" ? "selected" : ""} onClick={() => setMode("x01")}>X01</button><button type="button" className={mode === "fixed_visits" ? "selected" : ""} onClick={() => setMode("fixed_visits")}>{t.series}</button></div></fieldset>
    {mode === "x01" ? <><fieldset><legend>Игра</legend><div className="segments">{([301,501,701] as const).map(score=><button type="button" key={score} className={startingScore===score?'selected':''} onClick={()=>setStartingScore(score)}>{score}</button>)}</div></fieldset><fieldset><legend>Завершение</legend><div className="segments"><button type="button" className={outRule==='straight'?'selected':''} onClick={()=>setOutRule('straight')}>Любым попаданием</button><button type="button" className={outRule==='double'?'selected':''} onClick={()=>setOutRule('double')}>Удвоением</button></div><p className="hint">{outRule==='straight'?'Для победы достаточно получить ровно 0.':'Последний дротик должен попасть в удвоение или Bull.'}</p></fieldset><fieldset><legend>Формат X01</legend><div className="segments"><button type="button" className={x01Format === "unlimited" ? "selected" : ""} onClick={() => setX01Format("unlimited")}>До победы</button><button type="button" className={x01Format === "limited" ? "selected" : ""} onClick={() => setX01Format("limited")}>Ограничить количество подходов</button></div></fieldset>{x01Format === "limited" ? <VisitsField visits={visits} custom={custom} onVisits={setVisits} onCustom={setCustom}/> : null}</> : <VisitsField visits={visits} custom={custom} onVisits={setVisits} onCustom={setCustom}/>} 
    <fieldset><legend>{t.starts}</legend><div className="starter-grid">{participants.map((participant, index) => <button type="button" key={index} className={starter === index ? "selected" : ""} onClick={() => setStarter(index)}>{participant.name || `Игрок ${index + 1}`}</button>)}<button type="button" className={starter === "random" ? "selected" : ""} onClick={() => setStarter("random")}>{t.random}</button></div></fieldset>
    <button className="primary start" onClick={() => void start()} disabled={busy || !valid}>{busy ? "Создаём…" : t.start}</button></section><nav className="home-links"><button className="link-button" onClick={onHistory}>{t.history}</button><button className="link-button" onClick={onStatistics}>Статистика</button></nav></main>;
}

function VisitsField({ visits, custom, onVisits, onCustom }: { visits: number; custom: boolean; onVisits: (value: number) => void; onCustom: (value: boolean) => void }) {
  return <fieldset><legend>{t.visits}</legend><div className="segments five">{[5, 10, 20, 30].map((value) => <button type="button" key={value} className={!custom && visits === value ? "selected" : ""} onClick={() => { onVisits(value); onCustom(false); }}>{value}</button>)}<button type="button" className={custom ? "selected" : ""} onClick={() => onCustom(true)}>{t.other}</button></div>{custom ? <input type="number" min="1" max="999" value={visits} onChange={(event) => onVisits(Number(event.target.value))} aria-label="Другое количество подходов"/> : null}</fieldset>;
}
