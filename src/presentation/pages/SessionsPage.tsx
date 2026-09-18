import { useEffect, useMemo, useState } from 'react';
import type { CompetitiveRepository } from '../../application/ports/repositories';
import type { CompetitiveSession } from '../../domain/competitive/models';
import type { Match, Player, PlayerId } from '../../domain/match/models';
import { statisticsForPlayerHistory } from '../../domain/statistics/StatisticsCalculator';

const titleFor = (session: CompetitiveSession) =>
  session.title ?? `Игровая сессия · ${new Date(session.createdAt).toLocaleDateString('ru-RU')}`;
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
  const [title, setTitle] = useState('');
  useEffect(() => {
    void repository
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [repository]);
  const create = async () => {
    if (selected.length < 2) return;
    const session: CompetitiveSession = {
      id: id(),
      createdAt: now(),
      ...(title.trim() ? { title: title.trim() } : {}),
      playerIds: selected,
      matchIds: [],
    };
    await repository.saveSession(session);
    setSessions((current) => [session, ...current]);
    setSelected([]);
    setTitle('');
  };
  return (
    <main className="statistics-page sessions-page">
      <header className="stats-header">
        <button className="text-icon" onClick={onBack} aria-label="Назад">
          ‹
        </button>
        <div>
          <h1>Игровые сессии</h1>
          <p>Объединяют обычные матчи одного вечера</p>
        </div>
      </header>
      <section className="stat-section">
        <h2>Новая сессия</h2>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Например, Вечер 18 сентября"
        />
        <div className="stats-tabs compact">
          {players.map((player) => (
            <button
              key={player.id}
              className={selected.includes(player.id) ? 'selected' : ''}
              onClick={() =>
                setSelected((current) =>
                  current.includes(player.id)
                    ? current.filter((id) => id !== player.id)
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
        <button className="primary" disabled={selected.length < 2} onClick={() => void create().catch(() => undefined)}>
          Начать сессию
        </button>
      </section>
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          players={players}
          matches={matches}
          onUse={onUse}
          onEnd={async () => {
            const ended = { ...session, endedAt: now() };
            await repository.saveSession(ended);
            setSessions((current) => current.map((item) => (item.id === ended.id ? ended : item)));
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
  onEnd,
}: {
  session: CompetitiveSession;
  players: readonly Player[];
  matches: readonly Match[];
  onUse: (session: CompetitiveSession) => void;
  onEnd: () => Promise<void>;
}) {
  const sessionMatches = useMemo(
    () => matches.filter((match) => session.matchIds.includes(match.id)),
    [matches, session.matchIds],
  );
  return (
    <section className="stat-section">
      <h2>{titleFor(session)}</h2>
      <p>
        {session.endedAt ? 'Завершена' : 'Активна'} · матчей: {sessionMatches.length}
      </p>
      {session.playerIds.map((id) => {
        const player = players.find((item) => item.id === id);
        const stats = statisticsForPlayerHistory(sessionMatches, id, 'all', 'all');
        return (
          <p key={id}>
            <strong>{player?.name ?? 'Игрок'}</strong> · {stats.wins} побед · Avg {stats.threeDartAverage.toFixed(1)} ·
            лучший {stats.bestVisit}
          </p>
        );
      })}
      {!session.endedAt ? (
        <>
          <button className="primary" onClick={() => onUse(session)}>
            Играть в этой сессии
          </button>
          <button className="secondary" onClick={() => void onEnd().catch(() => undefined)}>
            Завершить игровую сессию
          </button>
        </>
      ) : null}
    </section>
  );
}
