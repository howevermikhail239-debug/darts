import { useEffect, useMemo, useState } from 'react';
import type { CompetitiveRepository } from '../../application/ports/repositories';
import type { Player } from '../../domain/match/models';
import type { TrainingKind, TrainingSession } from '../../domain/competitive/models';
import {
  bobs27Score,
  doublesClockTargets,
  summarizeTraining,
  trainingHistory,
} from '../../domain/competitive/training';

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
  const [doubleTarget, setDoubleTarget] = useState('D20');
  const [clockAttempts, setClockAttempts] = useState<1 | 2 | 3 | 'unlimited'>('unlimited');
  const [checkoutRange, setCheckoutRange] = useState('41-60');
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
  const clockIndex = Math.min(
    doublesClockTargets.length - 1,
    clockAttempts === 'unlimited' ? attempts.length : Math.floor(attempts.length / clockAttempts),
  );
  const checkoutBounds = checkoutRange.split('-').map(Number);
  const target =
    kind === 'doubles'
      ? doubleTarget === 'Random'
        ? doublesClockTargets[attempts.length % doublesClockTargets.length]!
        : doubleTarget
      : kind === 'around_the_clock'
        ? doublesClockTargets[clockIndex]!
        : kind === 'checkout'
          ? String(
              (checkoutBounds[0] ?? 41) +
                ((attempts.length * 17) % ((checkoutBounds[1] ?? 60) - (checkoutBounds[0] ?? 41) + 1)),
            )
          : targetFor(kind, attempts.length);
  const summary = summarizeTraining(attempts);
  const history = useMemo(() => saved.slice(0, 5), [saved]);
  const historySummary = useMemo(() => trainingHistory(saved), [saved]);
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
        settings: {
          mode: kind,
          ...(kind === 'doubles' ? { target: doubleTarget } : {}),
          ...(kind === 'around_the_clock' ? { attemptsPerTarget: clockAttempts } : {}),
          ...(kind === 'checkout' ? { range: checkoutRange } : {}),
        },
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
            {kind === 'doubles' ? (
              <label>
                Цель
                <select value={doubleTarget} onChange={(event) => setDoubleTarget(event.target.value)}>
                  {[...doublesClockTargets, 'Random'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {kind === 'around_the_clock' ? (
              <label>
                Попыток на double
                <select
                  value={clockAttempts}
                  onChange={(event) =>
                    setClockAttempts(
                      event.target.value === 'unlimited' ? 'unlimited' : (Number(event.target.value) as 1 | 2 | 3),
                    )
                  }
                >
                  <option value="unlimited">Без лимита</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
            ) : null}
            {kind === 'checkout' ? (
              <label>
                Диапазон
                <select value={checkoutRange} onChange={(event) => setCheckoutRange(event.target.value)}>
                  {['41-60', '41-100', '61-100', '81-120'].map((range) => (
                    <option key={range}>{range}</option>
                  ))}
                </select>
              </label>
            ) : null}
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
              Попаданий: {summary.hits} / {summary.attempts} · {summary.accuracy.toFixed(0)}% · серия {summary.streak} /
              лучший {summary.bestStreak}
            </p>
            {kind === 'bobs_27' ? (
              <p>
                Счёт Bob’s 27: <strong>{bobs27Score(attempts)}</strong>
              </p>
            ) : null}
            {kind === 'around_the_clock' ? (
              <p>
                Прогресс: {clockIndex + 1} / {doublesClockTargets.length}
              </p>
            ) : null}
            {kind === 'checkout' ? (
              <p className="stats-note">
                Ввод фиксирует фактический результат; маршрут можно сверить с обычными подсказками checkout.
              </p>
            ) : null}
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
            <p>
              Всего: {historySummary.attempts} попыток · {historySummary.darts} дротиков · точность{' '}
              {historySummary.accuracy.toFixed(0)}%
            </p>
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
