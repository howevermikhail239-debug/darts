import { useEffect, useMemo, useState } from 'react';
import type { CompetitiveRepository } from '../../application/ports/repositories';
import type { CompetitiveSession } from '../../domain/competitive/models';
import type { Match, Player, PlayerId } from '../../domain/match/models';
import { statisticsForPlayerHistory } from '../../domain/statistics/StatisticsCalculator';
import { ratingsForMatches } from '../../domain/competitive/rating';

const dateTitle = (date: string) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const titleFor = (session: CompetitiveSession) => session.title ?? `Игровая сессия · ${dateTitle(session.createdAt)}`;
const newTitle = (items: readonly CompetitiveSession[], at: string) => {
  const base = `Игровая сессия · ${dateTitle(at)}`;
  const count = items.filter((item) => titleFor(item).startsWith(base)).length + 1;
  return count === 1 ? base : `${base}, ${count}`;
};

export function SessionsPage({
  players,
  matches,
  repository,
  id,
  now,
  onBack,
  onUse,
}: {
  players: readonly Player[];
  matches: readonly Match[];
  repository: CompetitiveRepository;
  id: () => string;
  now: () => string;
  onBack: () => void;
  onUse: (session: CompetitiveSession) => void;
}) {
  const [sessions, setSessions] = useState<readonly CompetitiveSession[]>([]);
  const [selected, setSelected] = useState<readonly PlayerId[]>([]);
  const [rename, setRename] = useState<CompetitiveSession>();
  const [name, setName] = useState('');
  useEffect(() => {
    void repository
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [repository]);
  const start = async () => {
    if (selected.length < 2) return;
    const createdAt = now();
    const session: CompetitiveSession = {
      id: id(),
      createdAt,
      title: newTitle(sessions, createdAt),
      playerIds: selected,
      matchIds: [],
    };
    await repository.saveSession(session);
    setSessions((items) => [session, ...items]);
    setSelected([]);
    onUse(session);
  };
  const saveRename = async () => {
    if (!rename || !name.trim()) return;
    const updated = { ...rename, title: name.trim() };
    await repository.saveSession(updated);
    setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setRename(undefined);
  };
  return (
    <main className="statistics-page sessions-page">
      <header className="stats-header">
        <button className="text-icon" onClick={onBack} aria-label="Назад">
          ‹
        </button>
        <div>
          <h1>Игровые сессии</h1>
          <p>Соберите матчи одного вечера в понятную историю</p>
        </div>
      </header>
      <section className="stat-section session-start">
        <h2>Начать игровую сессию</h2>
        <p>Выберите участников — название и дата появятся автоматически.</p>
        <div className="stats-tabs compact" aria-label="Участники сессии">
          {players.map((player) => (
            <button
              key={player.id}
              className={selected.includes(player.id) ? 'selected' : ''}
              onClick={() =>
                setSelected((current) =>
                  current.includes(player.id)
                    ? current.filter((item) => item !== player.id)
                    : current.length < 8
                      ? [...current, player.id]
                      : current,
                )
              }
            >
              {player.name}
            </button>
          ))}
        </div>
        <button className="primary" disabled={selected.length < 2} onClick={() => void start().catch(() => undefined)}>
          Начать игровой вечер
        </button>
      </section>
      {rename ? (
        <section className="stat-section">
          <h2>Изменить название</h2>
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Название сессии" />
          <div className="training-actions">
            <button className="secondary" onClick={() => setRename(undefined)}>
              Отмена
            </button>
            <button className="primary" onClick={() => void saveRename().catch(() => undefined)}>
              Сохранить
            </button>
          </div>
        </section>
      ) : null}
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          players={players}
          matches={matches}
          onUse={onUse}
          onRename={() => {
            setRename(session);
            setName(titleFor(session));
          }}
          onEnd={async () => {
            const ended = { ...session, endedAt: now() };
            await repository.saveSession(ended);
            setSessions((items) => items.map((item) => (item.id === ended.id ? ended : item)));
          }}
        />
      ))}
    </main>
  );
}

function SessionCard({
  session,
  players,
  matches,
  onUse,
  onRename,
  onEnd,
}: {
  session: CompetitiveSession;
  players: readonly Player[];
  matches: readonly Match[];
  onUse: (session: CompetitiveSession) => void;
  onRename: () => void;
  onEnd: () => Promise<void>;
}) {
  const sessionMatches = useMemo(
    () => matches.filter((match) => session.matchIds.includes(match.id)),
    [matches, session.matchIds],
  );
  const before = useMemo(
    () =>
      ratingsForMatches(
        matches.filter((match) => match.createdAt < session.createdAt),
        session.playerIds,
      ),
    [matches, session.createdAt, session.playerIds],
  );
  const after = useMemo(
    () =>
      ratingsForMatches(
        [...matches.filter((match) => match.createdAt < session.createdAt), ...sessionMatches],
        session.playerIds,
      ),
    [matches, session.createdAt, session.playerIds, sessionMatches],
  );
  return (
    <section className="stat-section session-card">
      <div className="session-heading">
        <div>
          <h2>{titleFor(session)}</h2>
          <p>
            {dateTitle(session.createdAt)} · {session.endedAt ? 'завершена' : 'активна'} · {sessionMatches.length}{' '}
            матчей
          </p>
        </div>
        <button className="secondary" onClick={onRename}>
          Изменить название
        </button>
      </div>
      <p className="session-participants">
        Участники:{' '}
        {session.playerIds.map((id) => players.find((player) => player.id === id)?.name ?? 'Игрок').join(' · ')}
      </p>
      <div className="session-scoreboard">
        {session.playerIds.map((playerId) => {
          const stats = statisticsForPlayerHistory(sessionMatches, playerId, 'all', 'all');
          const delta = (after.get(playerId)?.rating ?? 1500) - (before.get(playerId)?.rating ?? 1500);
          return (
            <div key={playerId}>
              <strong>{players.find((player) => player.id === playerId)?.name ?? 'Игрок'}</strong>
              <span>
                {stats.wins}W · {stats.losses}L · {stats.draws}D
              </span>
              <span>
                Рейтинг {before.get(playerId)?.rating ?? 1500} → {after.get(playerId)?.rating ?? 1500} (
                {delta >= 0 ? '+' : ''}
                {delta})
              </span>
            </div>
          );
        })}
      </div>
      {!session.endedAt ? (
        <div className="training-actions">
          <button className="primary" onClick={() => onUse(session)}>
            Следующий матч
          </button>
          <button className="secondary" onClick={() => void onEnd().catch(() => undefined)}>
            Завершить сессию
          </button>
        </div>
      ) : null}
    </section>
  );
}
