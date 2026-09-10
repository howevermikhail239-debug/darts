import { useState, type FormEvent } from "react";
import type { MatchSetup } from "../../domain/match/createMatch";
import type { MatchParticipantInput } from "../../application/StartMatch";
import type { Player, PlayerId } from "../../domain/match/models";
import { PlayerIdentity } from "../components/PlayerIdentity";
import { t } from "../strings";

export type SetupParticipant = MatchParticipantInput;
type ParticipantDraft = { name: string; playerId?: PlayerId };
type Props = {
  saved: readonly Player[];
  onStart: (participants: readonly SetupParticipant[], setup: MatchSetup) => Promise<void>;
  onHistory: () => void;
  onStatistics: () => void;
  onAddLocalPlayer?: ((name: string) => Promise<Player>) | undefined;
  company?: { name: string } | undefined;
  onCreateCompany?: ((name: string) => Promise<void>) | undefined;
  onAddSharedPlayer?: ((name: string) => Promise<Player>) | undefined;
  onLeaveCompany?: (() => void) | undefined;
  onRetry?: (() => Promise<void>) | undefined;
  syncNote?: string | undefined;
};

const defaultParticipant = (index: number): ParticipantDraft => ({ name: `Игрок ${index + 1}` });

export function SetupPage({ saved, onStart, onHistory, onStatistics, onAddLocalPlayer, company, onCreateCompany, onAddSharedPlayer, onLeaveCompany, onRetry, syncNote }: Props) {
  const [participants, setParticipants] = useState<ParticipantDraft[]>([defaultParticipant(0), defaultParticipant(1)]);
  const [mode, setMode] = useState<"x01" | "fixed_visits">("x01");
  const [x01Format, setX01Format] = useState<"unlimited" | "limited">("unlimited");
  const [startingScore, setStartingScore] = useState<301 | 501 | 701>(501);
  const [outRule, setOutRule] = useState<"straight" | "double">("straight");
  const [visits, setVisits] = useState(20);
  const [custom, setCustom] = useState(false);
  const [starter, setStarter] = useState<number | "random">(0);
  const [busy, setBusy] = useState(false);
  const createProfile = company ? onAddSharedPlayer : onAddLocalPlayer;

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
      const setup: MatchSetup = mode === "x01"
        ? { mode, startingScore, outRule, format: x01Format === "unlimited" ? { kind: "unlimited" } : { kind: "limited", visitsPerPlayer: visits }, startingPlayerIndex }
        : { mode, visitsPerPlayer: visits, startingPlayerIndex };
      await onStart(clean, setup);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-page">
      <header className="brand"><div className="brand-mark" aria-hidden="true">◎</div><div><h1>{t.newGame}</h1><p>Настройте матч — и к мишени.</p></div></header>
      <CompanyContextPanel company={company} syncNote={syncNote} onCreateCompany={onCreateCompany} onAddSharedPlayer={onAddSharedPlayer} onLeaveCompany={onLeaveCompany} onRetry={onRetry} />
      <section className="setup-form" aria-label="Настройка матча">
        <div className="setup-section-title"><span>1</span><div><h2>Участники</h2><p>Профиль хранит статистику между матчами. Временный игрок — только для этой игры.</p></div></div>
        <ParticipantList
          participants={participants}
          saved={saved}
          profileLabel={company ? "Профиль компании" : "Профиль игрока"}
          onCreateProfile={createProfile}
          onChange={setParticipants}
          onRemove={(index) => { setParticipants((current) => current.filter((_, itemIndex) => itemIndex !== index)); setStarter(0); }}
          onAdd={() => setParticipants((current) => [...current, defaultParticipant(current.length)])}
        />
        {!participantsValid ? <p className="reason">Имена должны быть заполнены, а сохранённый профиль нельзя выбрать дважды.</p> : null}
        {visitsRequired && !visitsValid ? <p className="reason">Количество подходов должно быть от 1 до 999.</p> : null}
        <div className="setup-section-title"><span>2</span><div><h2>Правила матча</h2><p>Главные параметры — без лишних шагов</p></div></div>
        <GameModeSelector
          mode={mode} onMode={setMode} startingScore={startingScore} onStartingScore={setStartingScore}
          outRule={outRule} onOutRule={setOutRule} x01Format={x01Format} onX01Format={setX01Format}
          visits={visits} custom={custom} onVisits={setVisits} onCustom={setCustom}
        />
        <div className="setup-section-title compact"><span>3</span><div><h2>Кто начинает</h2></div></div>
        <StarterSelector participants={participants} starter={starter} onStarter={setStarter} />
        <button className="primary start" onClick={() => void start()} disabled={busy || !valid}>{busy ? "Создаём…" : t.start}</button>
      </section>
      <nav className="home-links"><button className="link-button" onClick={onHistory}>{t.history}</button><button className="link-button" onClick={onStatistics}>Статистика</button></nav>
    </main>
  );
}

function CompanyContextPanel({ company, syncNote, onCreateCompany, onAddSharedPlayer, onLeaveCompany, onRetry }: Pick<Props, "company" | "syncNote" | "onCreateCompany" | "onAddSharedPlayer" | "onLeaveCompany" | "onRetry">) {
  const [companyName, setCompanyName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string>();

  const createCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onCreateCompany || createBusy) return;
    setCreateBusy(true);
    setCreateError(undefined);
    try {
      await onCreateCompany(companyName.trim());
    } catch {
      setCreateError("Не удалось создать компанию. Проверьте подключение и попробуйте ещё раз.");
    } finally {
      setCreateBusy(false);
    }
  };

  if (company) return (
    <section className="company-context" aria-label="Компания">
      <div className="context-heading"><span className="context-icon" aria-hidden="true">◆</span><div><b>Компания{company.name ? ` · ${company.name}` : ""}</b><small>Общие профили, история и статистика</small></div></div>
      <span className={syncNote ? "sync-state pending" : "sync-state saved"} role="status">{syncNote ?? "Все матчи синхронизированы"}</span>
      <p className="company-guidance">Добавьте постоянных игроков ниже или сразу настройте и начните матч.</p>
      <p className="company-guidance">Чтобы открыть эту же компанию на другом устройстве, отправьте игрокам ссылку-приглашение.</p>
      <button className="link-button" onClick={() => void navigator.clipboard?.writeText(location.href)}>Скопировать ссылку для приглашения</button>
      {syncNote ? <button className="link-button" onClick={() => void onRetry?.()}>Повторить</button> : null}
      <button className="link-button" onClick={onLeaveCompany}>Это устройство</button>
      <label>Добавить игрока компании<input value={playerName} maxLength={80} onChange={(event) => setPlayerName(event.target.value)} /></label>
      <button className="secondary" disabled={!playerName.trim()} onClick={() => { if (onAddSharedPlayer) void onAddSharedPlayer(playerName).then(() => setPlayerName("")); }}>Добавить игрока</button>
    </section>
  );
  return (
    <section className="company-context" aria-label="Создание компании">
      <div className="context-heading"><span className="context-icon" aria-hidden="true">●</span><div><b>Локальная игра</b><small>Матчи хранятся только на этом устройстве</small></div></div>
      {creatingCompany ? (
        <form className="company-create-form" onSubmit={(event) => void createCompany(event)} aria-busy={createBusy}>
          <p className="company-guidance">Создайте общее пространство для игроков, матчей и статистики. После создания здесь появятся название, приглашение и следующий шаг.</p>
          <label>Название компании (необязательно)<input value={companyName} maxLength={80} disabled={createBusy} onChange={(event) => setCompanyName(event.target.value)} /></label>
          {createError ? <p className="company-create-error" role="alert">{createError}</p> : null}
          <button type="submit" className="primary" disabled={createBusy || !onCreateCompany}>{createBusy ? "Создаём компанию…" : "Создать"}</button>
        </form>
      ) : <button className="secondary" onClick={() => setCreatingCompany(true)}>Создать компанию</button>}
    </section>
  );
}

function ParticipantList({ participants, saved, profileLabel, onCreateProfile, onChange, onRemove, onAdd }: { participants: readonly ParticipantDraft[]; saved: readonly Player[]; profileLabel: string; onCreateProfile?: ((name: string) => Promise<Player>) | undefined; onChange: (participants: ParticipantDraft[]) => void; onRemove: (index: number) => void; onAdd: () => void }) {
  return <><div className="player-fields">{participants.map((participant, index) => (
    <ParticipantRow key={index} participant={participant} index={index} saved={saved} profileLabel={profileLabel} onCreateProfile={onCreateProfile} removable={participants.length > 2} onChange={(next) => onChange(participants.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => onRemove(index)} />
  ))}</div>{participants.length < 8 ? <button type="button" className="secondary add-player" onClick={onAdd}>+ Добавить игрока</button> : null}</>;
}

function ParticipantRow({ participant, index, saved, profileLabel, onCreateProfile, removable, onChange, onRemove }: { participant: ParticipantDraft; index: number; saved: readonly Player[]; profileLabel: string; onCreateProfile?: ((name: string) => Promise<Player>) | undefined; removable: boolean; onChange: (participant: ParticipantDraft) => void; onRemove: () => void }) {
  const [creating, setCreating] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selected = participant.playerId
    ? saved.find((player) => player.id === participant.playerId) ?? { id: participant.playerId, name: participant.name, createdAt: "" }
    : undefined;
  const openCreator = () => {
    const defaultName = `Игрок ${index + 1}`;
    setProfileName(participant.name === defaultName ? "" : participant.name);
    setError(undefined);
    setCreating(true);
  };
  const createAndSelect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onCreateProfile || busy || !profileName.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const player = await onCreateProfile(profileName.trim());
      onChange({ name: player.name, playerId: player.id });
      setCreating(false);
    } catch {
      setError("Не удалось создать профиль. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`participant-card ${selected ? "profile" : "temporary"}`}>
      <div className="participant-card-heading"><span>Игрок {index + 1}</span>{removable ? <button type="button" className="remove-player" onClick={onRemove} aria-label={`Удалить игрока ${index + 1}`}>×</button> : null}</div>
      {selected ? <div className="selected-profile"><PlayerIdentity playerId={selected.id} name={selected.name} position={index} /><small>{profileLabel} · статистика сохраняется</small></div> : <>
        <label className="temporary-name">Имя для этого матча<input aria-label={`Имя игрока ${index + 1}`} value={participant.name} onChange={(event) => onChange({ name: event.target.value })} maxLength={28} /></label>
        <p className="participant-semantic">Временный игрок · статистика только этого матча</p>
      </>}
      {saved.length ? <label className="profile-picker">{selected ? "Сменить игрока" : "Выбрать профиль"}<select aria-label={`Выбрать сохранённого игрока ${index + 1}`} value={participant.playerId ?? ""} onChange={(event) => { const player = saved.find((item) => item.id === event.target.value); onChange(player ? { name: player.name, playerId: player.id } : { name: `Игрок ${index + 1}` }); }}><option value="">Временный игрок</option>{saved.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label> : null}
      {onCreateProfile && !creating ? <button type="button" className="profile-slot-action" onClick={openCreator}>{selected ? "Создать другой профиль" : participant.name === `Игрок ${index + 1}` ? "Создать профиль" : "Сохранить как профиль"}</button> : null}
      {creating ? <form className="slot-profile-form" onSubmit={(event) => void createAndSelect(event)} aria-busy={busy}>
        <label>Имя профиля<input autoFocus value={profileName} maxLength={80} disabled={busy} onChange={(event) => setProfileName(event.target.value)} /></label>
        <p>Профиль сохранит статистику между матчами.</p>
        {error ? <p className="reason" role="alert">{error}</p> : null}
        <div><button type="submit" className="secondary" disabled={busy || !profileName.trim()}>{busy ? "Создаём…" : "Создать и выбрать"}</button><button type="button" className="quiet-button" disabled={busy} onClick={() => setCreating(false)}>Отмена</button></div>
      </form> : null}
    </article>
  );
}

type GameModeSelectorProps = {
  mode: "x01" | "fixed_visits"; onMode: (mode: "x01" | "fixed_visits") => void;
  startingScore: 301 | 501 | 701; onStartingScore: (score: 301 | 501 | 701) => void;
  outRule: "straight" | "double"; onOutRule: (rule: "straight" | "double") => void;
  x01Format: "unlimited" | "limited"; onX01Format: (format: "unlimited" | "limited") => void;
  visits: number; custom: boolean; onVisits: (value: number) => void; onCustom: (value: boolean) => void;
};

function GameModeSelector({ mode, onMode, startingScore, onStartingScore, outRule, onOutRule, x01Format, onX01Format, visits, custom, onVisits, onCustom }: GameModeSelectorProps) {
  return <>
    <fieldset><legend>{t.mode}</legend><div className="segments"><button type="button" className={mode === "x01" ? "selected" : ""} onClick={() => onMode("x01")}>X01</button><button type="button" className={mode === "fixed_visits" ? "selected" : ""} onClick={() => onMode("fixed_visits")}>{t.series}</button></div></fieldset>
    {mode === "x01" ? <>
      <fieldset><legend>Игра</legend><div className="segments">{([301, 501, 701] as const).map((score) => <button type="button" key={score} className={startingScore === score ? "selected" : ""} onClick={() => onStartingScore(score)}>{score}</button>)}</div></fieldset>
      <fieldset><legend>Завершение</legend><div className="segments"><button type="button" className={outRule === "straight" ? "selected" : ""} onClick={() => onOutRule("straight")}>Любым попаданием</button><button type="button" className={outRule === "double" ? "selected" : ""} onClick={() => onOutRule("double")}>Удвоением</button></div><p className="hint">{outRule === "straight" ? "Для победы достаточно получить ровно 0." : "Последний дротик должен попасть в удвоение или Bull."}</p></fieldset>
      <fieldset><legend>Формат X01</legend><div className="segments"><button type="button" className={x01Format === "unlimited" ? "selected" : ""} onClick={() => onX01Format("unlimited")}>До победы</button><button type="button" className={x01Format === "limited" ? "selected" : ""} onClick={() => onX01Format("limited")}>Ограничить количество подходов</button></div></fieldset>
      {x01Format === "limited" ? <VisitsField visits={visits} custom={custom} onVisits={onVisits} onCustom={onCustom} /> : null}
    </> : <VisitsField visits={visits} custom={custom} onVisits={onVisits} onCustom={onCustom} />}
  </>;
}

function StarterSelector({ participants, starter, onStarter }: { participants: readonly ParticipantDraft[]; starter: number | "random"; onStarter: (starter: number | "random") => void }) {
  return <fieldset><legend>{t.starts}</legend><div className="starter-grid">{participants.map((participant, index) => <button type="button" key={index} className={starter === index ? "selected" : ""} onClick={() => onStarter(index)}>{participant.name || `Игрок ${index + 1}`}</button>)}<button type="button" className={starter === "random" ? "selected" : ""} onClick={() => onStarter("random")}>{t.random}</button></div></fieldset>;
}

function VisitsField({ visits, custom, onVisits, onCustom }: { visits: number; custom: boolean; onVisits: (value: number) => void; onCustom: (value: boolean) => void }) {
  return <fieldset><legend>{t.visits}</legend><div className="segments five">{[5, 10, 20, 30].map((value) => <button type="button" key={value} className={!custom && visits === value ? "selected" : ""} onClick={() => { onVisits(value); onCustom(false); }}>{value}</button>)}<button type="button" className={custom ? "selected" : ""} onClick={() => onCustom(true)}>{t.other}</button></div>{custom ? <input type="number" min="1" max="999" value={visits} onChange={(event) => onVisits(Number(event.target.value))} aria-label="Другое количество подходов" /> : null}</fieldset>;
}
