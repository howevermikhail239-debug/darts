import { useEffect, useMemo, useState } from 'react';
import type { CompetitiveRepository } from '../../application/ports/repositories';
import type { Player } from '../../domain/match/models';
import type { TrainingKind, TrainingSession } from '../../domain/competitive/models';

const labels: Record<TrainingKind, string> = {
  doubles: 'Даблы',
  around_the_clock: 'По кругу · даблы',
  checkout: 'Checkout practice',
  bobs_27: "Bob's 27",
};
const targetFor = (kind: TrainingKind, count: number) =>
  kind === 'around_the_clock'
    ? `D${Math.min(20, count + 1)}`
    : kind === 'checkout'
      ? String(41 + ((count * 17) % 60))
      : kind === 'bobs_27'
        ? `D${Math.min(20, count + 1)}`
        : 'D20';

export function TrainingPage({
  players,
  repository,
  id,
  now,
  onBack,
}: {
  players: readonly Player[];
  repository: CompetitiveRepository;
  id: () => string;
  now: () => string;
  onBack: () => void;
}) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '');
  const [kind, setKind] = useState<TrainingKind>('doubles');
  const [attempts, setAttempts] = useState<TrainingSession['attempts']>([]);
  const [saved, setSaved] = useState<readonly TrainingSession[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void repository
      .listTraining(playerId)
      .then((items) => live && setSaved(items))
      .catch(() => live && setSaved([]));
    return () => {
      live = false;
    };
  }, [playerId, repository]);
  const target = targetFor(kind, attempts.length);
  const accuracy = attempts.length ? (attempts.filter((attempt) => attempt.success).length * 100) / attempts.length : 0;
  const history = useMemo(() => saved.slice(0, 5), [saved]);
  const record = (success: boolean) =>
    setAttempts((current) => [...current, { target, darts: [success ? target : 'MISS'], success }]);
  const finish = async () => {
    if (!playerId || !attempts.length) return;
    setBusy(true);
    try {
      const session: TrainingSession = {
        id: id(),
        playerId,
        kind,
        startedAt: now(),
        completedAt: now(),
        attempts,
        settings: { mode: kind },
      };
      await repository.saveTraining(session);
      setSaved((current) => [session, ...current]);
      setAttempts([]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="statistics-page training-page">
      <header className="stats-header">
        <button className="text-icon" onClick={onBack} aria-label="Назад">
          ‹
        </button>
        <div>
          <h1>Тренировка</h1>
          <p>Результаты не влияют на матчевую статистику и рейтинг</p>
        </div>
      </header>
      {!players.length ? (
        <p className="empty">Сначала создайте постоянный профиль игрока.</p>
      ) : (
        <>
          <label>
            Игрок
            <select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <div className="stats-tabs compact">
            {(Object.keys(labels) as TrainingKind[]).map((item) => (
              <button
                key={item}
                className={kind === item ? 'selected' : ''}
                onClick={() => {
                  setKind(item);
                  setAttempts([]);
                }}
              >
                {labels[item]}
              </button>
            ))}
          </div>
          <section className="stat-section">
            <h2>{labels[kind]}</h2>
            <p>
              Цель: <strong>{target}</strong> · попытка {attempts.length + 1}
            </p>
            <div className="training-actions">
              <button className="primary" onClick={() => record(true)}>
                Попал
              </button>
              <button className="secondary" onClick={() => record(false)}>
                Мимо
              </button>
            </div>
            <p>
              Попаданий: {attempts.filter((attempt) => attempt.success).length} / {attempts.length} ·{' '}
              {accuracy.toFixed(0)}%
            </p>
            <button
              className="primary"
              disabled={!attempts.length || busy}
              onClick={() => void finish().catch(() => undefined)}
            >
              Завершить тренировку
            </button>
          </section>
          <section className="stat-section">
            <h2>Последние тренировки</h2>
            {history.length ? (
              <ul>
                {history.map((session) => (
                  <li key={session.id}>
                    {labels[session.kind]} · {session.attempts.filter((attempt) => attempt.success).length} /{' '}
                    {session.attempts.length} · {new Date(session.startedAt).toLocaleDateString('ru-RU')}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Пока нет завершённых тренировок.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
