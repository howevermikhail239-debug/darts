import { useMemo, useState } from 'react';
import type { Match, Player, PlayerId } from '../../domain/match/models';
import {
  MIN_PERCENT_RECORD_DARTS,
  distributionKeys,
  headToHead,
  percentage,
  recordsForPlayer,
  statisticsForPlayerHistory,
  trendForPlayer,
  type PlayerHistoryStatistics,
  type StatisticsMode,
  type StatisticsPeriod,
  type TrendMetric,
} from '../../domain/statistics/StatisticsCalculator';
import { PlayerIdentity } from '../components/PlayerIdentity';
import { recentForm } from '../../domain/statistics/todaySummary';
import { currentStreak } from '../../domain/statistics/todaySummary';
import { DartboardHeatmap } from '../components/DartboardHeatmap';
import { ratingsForMatches } from '../../domain/competitive/rating';
import { x01Analytics } from '../../domain/statistics/x01Analytics';

type Section = 'overview' | 'hits' | 'board' | 'distribution' | 'trends' | 'records';
const modeLabels: Record<StatisticsMode, string> = { all: 'Все', x01: 'X01', fixed_visits: 'Набор очков' };
const periodLabels: Record<StatisticsPeriod, string> = {
  5: 'Последние 5',
  10: 'Последние 10',
  20: 'Последние 20',
  all: 'Всё время',
};
const trendLabels: Record<TrendMetric, string> = {
  threeDartAverage: 'Среднее за 3 дротика',
  bestVisit: 'Лучший подход',
  missPercent: 'Промахи, %',
  triplePercent: 'Доля утроений, %',
  '100Plus': '100+ за игру',
};
const pct = (value: number) => `${value.toFixed(1)}%`;
const number = (value: number) => value.toFixed(1);

type Props = {
  matches: readonly Match[];
  players: readonly Player[];
  initialPlayerIds?: readonly PlayerId[];
  onBack: () => void;
};
export function StatisticsPage({ matches, players, initialPlayerIds = [], onBack }: Props) {
  const available = players;
  const availableById = useMemo(() => new Map(available.map((player) => [player.id, player])), [available]);
  const relevant = useMemo(
    () => initialPlayerIds.filter((id) => availableById.has(id)),
    [availableById, initialPlayerIds],
  );
  const matchesByPlayer = useMemo(() => {
    const index = new Map<PlayerId, Match[]>();
    const chronological = [...matches].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const match of chronological)
      for (const playerId of match.players) {
        const own = index.get(playerId);
        if (own) own.push(match);
        else index.set(playerId, [match]);
      }
    return index;
  }, [matches]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId | undefined>(() =>
    relevant.length === 1 ? relevant[0] : undefined,
  );
  const [compare, setCompare] = useState(() => relevant.length >= 2);
  const [mode, setMode] = useState<StatisticsMode>('all');
  const [period, setPeriod] = useState<StatisticsPeriod>('all');
  const selected = selectedPlayerId ? availableById.get(selectedPlayerId) : undefined;
  const contextualPlayers = relevant
    .map((id) => availableById.get(id))
    .filter((player): player is Player => Boolean(player));
  const showContextSwitcher = contextualPlayers.length >= 2 && (compare || selected);
  return (
    <main className="statistics-page">
      <header className="stats-header">
        <button className="text-icon" onClick={onBack} aria-label="Назад">
          ‹
        </button>
        <div>
          <h1>Статистика</h1>
          <p>Только подтверждённые броски</p>
        </div>
      </header>
      {showContextSwitcher ? (
        <ContextSwitcher
          players={contextualPlayers}
          selectedPlayerId={compare ? undefined : selectedPlayerId}
          onCompare={() => {
            setSelectedPlayerId(undefined);
            setCompare(true);
          }}
          onPlayer={(id) => {
            setCompare(false);
            setSelectedPlayerId(id);
          }}
        />
      ) : null}
      {available.length === 0 ? (
        <p className="empty">
          Здесь появится накопительная статистика профилей. Временные участники остаются доступны в истории матчей.
        </p>
      ) : compare ? (
        <Comparison
          matches={matches}
          matchesByPlayer={matchesByPlayer}
          players={available}
          initialPlayerIds={relevant}
          mode={mode}
          onMode={setMode}
          onClose={() => setCompare(false)}
          onPlayer={(id) => {
            setCompare(false);
            setSelectedPlayerId(id);
          }}
        />
      ) : selected ? (
        <PlayerDetails
          matches={matchesByPlayer.get(selected.id) ?? []}
          allMatches={matches}
          allPlayerIds={players.map((player) => player.id)}
          player={selected}
          mode={mode}
          period={period}
          onMode={setMode}
          onPeriod={setPeriod}
          onClose={() => setSelectedPlayerId(undefined)}
        />
      ) : (
        <Overview
          matchesByPlayer={matchesByPlayer}
          players={available}
          onSelect={setSelectedPlayerId}
          onCompare={() => setCompare(true)}
        />
      )}
    </main>
  );
}

function ContextSwitcher({
  players,
  selectedPlayerId,
  onCompare,
  onPlayer,
}: {
  players: readonly Player[];
  selectedPlayerId: PlayerId | undefined;
  onCompare: () => void;
  onPlayer: (id: PlayerId) => void;
}) {
  return (
    <nav className="stats-context-switcher" aria-label="Статистика участников матча">
      <button className={!selectedPlayerId ? 'selected' : ''} aria-pressed={!selectedPlayerId} onClick={onCompare}>
        Сравнение
      </button>
      {players.map((player) => (
        <button
          key={player.id}
          className={selectedPlayerId === player.id ? 'selected' : ''}
          aria-pressed={selectedPlayerId === player.id}
          onClick={() => onPlayer(player.id)}
        >
          <PlayerIdentity playerId={player.id} name={player.name} compact />
        </button>
      ))}
    </nav>
  );
}

function Overview({
  matchesByPlayer,
  players,
  onSelect,
  onCompare,
}: {
  matchesByPlayer: ReadonlyMap<PlayerId, readonly Match[]>;
  players: readonly Player[];
  onSelect: (id: PlayerId) => void;
  onCompare: () => void;
}) {
  // PERF-5: обзор считал статистику каждого игрока заново на каждый рендер.
  const cards = useMemo(
    () =>
      players.map((player) => ({
        player,
        stats: statisticsForPlayerHistory(
          matchesByPlayer.get(player.id) ?? [],
          player.id,
          'all',
          'all',
          player.statsResetAt,
        ),
      })),
    [matchesByPlayer, players],
  );
  return (
    <>
      <section className="stats-player-grid" aria-label="Игроки">
        {cards.map(({ player, stats }) => (
          <button key={player.id} className="stats-player-card" onClick={() => onSelect(player.id)}>
            <PlayerIdentity playerId={player.id} name={player.name} />
            <Metric label="Всего матчей" value={stats.matches} />
            <Metric label="Всего побед" value={stats.wins} />
            <Metric label="Процент побед" value={pct(stats.winRate)} />
            <Metric label="Среднее за 3 дротика" value={number(stats.threeDartAverage)} />
            <Metric label="Лучший подход" value={stats.bestVisit} />
            <Metric label="180" value={stats.thresholds['180']} />
          </button>
        ))}
      </section>
      {players.length >= 2 ? (
        <button className="primary stats-compare-action" onClick={onCompare}>
          Сравнить игроков
        </button>
      ) : null}
    </>
  );
}

function Filters({
  mode,
  period,
  onMode,
  onPeriod,
}: {
  mode: StatisticsMode;
  period: StatisticsPeriod;
  onMode: (value: StatisticsMode) => void;
  onPeriod: (value: StatisticsPeriod) => void;
}) {
  return (
    <section className="stats-filters" aria-label="Фильтры статистики">
      <label>
        Режим
        <select value={mode} onChange={(event) => onMode(event.target.value as StatisticsMode)}>
          {(Object.keys(modeLabels) as StatisticsMode[]).map((key) => (
            <option key={key} value={key}>
              {modeLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Период
        <select
          value={period}
          onChange={(event) =>
            onPeriod(event.target.value === 'all' ? 'all' : (Number(event.target.value) as 5 | 10 | 20))
          }
        >
          {([5, 10, 20, 'all'] as const).map((key) => (
            <option key={key} value={key}>
              {periodLabels[key]}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function PlayerDetails({
  matches,
  allMatches,
  allPlayerIds,
  player,
  mode,
  period,
  onMode,
  onPeriod,
  onClose,
}: {
  matches: readonly Match[];
  allMatches: readonly Match[];
  allPlayerIds: readonly PlayerId[];
  player: Player;
  mode: StatisticsMode;
  period: StatisticsPeriod;
  onMode: (value: StatisticsMode) => void;
  onPeriod: (value: StatisticsPeriod) => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('overview');
  const stats = useMemo(
    () => statisticsForPlayerHistory(matches, player.id, mode, period, player.statsResetAt),
    [matches, player.id, player.statsResetAt, mode, period],
  );
  const form = useMemo(
    () => recentForm(matches, player.id, 5, player.statsResetAt),
    [matches, player.id, player.statsResetAt],
  );
  const sparkline = useMemo(
    () => trendForPlayer(matches, player.id, 'threeDartAverage', mode, period, player.statsResetAt).slice(-8),
    [matches, player.id, player.statsResetAt, mode, period],
  );
  const streak = useMemo(
    () => currentStreak(matches, player.id, player.statsResetAt),
    [matches, player.id, player.statsResetAt],
  );
  const rating = useMemo(
    () => ratingsForMatches(allMatches, allPlayerIds).get(player.id),
    [allMatches, allPlayerIds, player.id],
  );
  const x01 = useMemo(() => x01Analytics(matches, player.id), [matches, player.id]);
  return (
    <>
      <button className="stats-back" onClick={onClose}>
        ← Все игроки
      </button>
      <PlayerHeader
        player={player}
        stats={stats}
        form={form}
        sparkline={sparkline}
        {...(streak ? { streak } : {})}
        {...(rating ? { rating } : {})}
      />
      <Filters mode={mode} period={period} onMode={onMode} onPeriod={onPeriod} />
      <nav className="stats-tabs" aria-label="Раздел статистики">
        {(['overview', 'hits', 'board', 'distribution', 'trends', 'records'] as const).map((key) => (
          <button key={key} className={section === key ? 'selected' : ''} onClick={() => setSection(key)}>
            {
              (
                {
                  overview: 'Обзор',
                  hits: 'Попадания',
                  board: 'Мишень',
                  distribution: 'Распределение',
                  trends: 'Динамика',
                  records: 'Рекорды',
                } as const
              )[key]
            }
          </button>
        ))}
      </nav>
      {section === 'overview' ? (
        <PlayerOverview stats={stats} x01={x01} />
      ) : section === 'hits' ? (
        <Hits stats={stats} />
      ) : section === 'board' ? (
        <DartboardHeatmap hitCounts={stats.hitCounts} detailedDarts={stats.knownHitDarts} />
      ) : section === 'distribution' ? (
        <Distribution stats={stats} />
      ) : section === 'trends' ? (
        <Trends
          matches={matches.filter((match) => !player.statsResetAt || match.createdAt >= player.statsResetAt)}
          playerId={player.id}
          mode={mode}
          period={period}
        />
      ) : (
        <Records
          matches={matches}
          playerId={player.id}
          mode={mode}
          {...(player.statsResetAt ? { statsResetAt: player.statsResetAt } : {})}
        />
      )}
    </>
  );
}

function PlayerHeader({
  player,
  stats,
  form,
  sparkline,
  streak,
  rating,
}: {
  player: Player;
  stats: PlayerHistoryStatistics;
  form: readonly ('win' | 'loss' | 'draw')[];
  sparkline: readonly Readonly<{ value: number }>[];
  streak?: Readonly<{ result: 'win' | 'loss' | 'draw'; count: number }>;
  rating?: Readonly<{ rating: number; peak: number; games: number; provisional: boolean }>;
}) {
  const labels = { win: 'В', loss: 'П', draw: 'Н' } as const;
  const formText = form.length ? form.map((result) => labels[result]).join(' · ') : 'Недостаточно завершённых матчей';
  const values = sparkline.map((point) => point.value);
  const min = Math.min(...values),
    max = Math.max(...values),
    span = Math.max(1, max - min);
  const points = values
    .map(
      (value, index) =>
        `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${34 - ((value - min) / span) * 28}`,
    )
    .join(' ');
  const trendText =
    values.length < 2
      ? 'Недостаточно данных для тренда'
      : `Среднее за 3 дротика в последних матчах: ${values.map(number).join(', ')}`;
  const streakText = streak
    ? `${streak.result === 'win' && streak.count >= 2 ? '🔥 ' : ''}${streak.count} ${streak.result === 'win' ? 'побед' : streak.result === 'loss' ? 'поражений' : 'ничьих'} подряд`
    : undefined;
  return (
    <section className="player-stat-header" aria-labelledby="player-stat-name">
      <div className="player-stat-identity">
        <PlayerIdentity playerId={player.id} name={player.name} />
        <h2 id="player-stat-name" className="visually-hidden">
          {player.name}
        </h2>
      </div>
      <div className="player-stat-average">
        <span>Среднее за 3 дротика</span>
        <strong>{number(stats.threeDartAverage)}</strong>
      </div>
      {rating ? (
        <div className="player-stat-average">
          <span>Рейтинг X01</span>
          <strong>{rating.rating}</strong>
          <small>{rating.provisional ? `Предварительный · ${rating.games} матч.` : `Пик ${rating.peak}`}</small>
        </div>
      ) : null}
      <div className="recent-form">
        <span>Последние матчи</span>
        <div aria-label={`Форма: ${formText}`}>
          {form.length ? (
            form.map((result, index) => (
              <i key={index} className={result}>
                {labels[result]}
              </i>
            ))
          ) : (
            <small>Пока мало данных</small>
          )}
        </div>
        {streakText ? <small>{streakText}</small> : null}
      </div>
      {values.length >= 2 ? (
        <div className="player-sparkline">
          <svg viewBox="0 0 100 40" role="img" aria-label={trendText} preserveAspectRatio="none">
            <polyline points={points} />
          </svg>
          <span>Тренд среднего</span>
        </div>
      ) : null}
    </section>
  );
}

function PlayerOverview({ stats, x01 }: { stats: PlayerHistoryStatistics; x01: ReturnType<typeof x01Analytics> }) {
  return (
    <section className="stat-section">
      <div className="metric-grid">
        <MetricCard label="Среднее за 3 дротика" value={number(stats.threeDartAverage)} />
        <MetricCard label="Среднее за дротик" value={number(stats.averagePerDart)} />
        <MetricCard label="Лучший подход" value={stats.bestVisit} />
        <MetricCard label="Всего матчей" value={stats.matches} />
        <MetricCard label="Всего побед" value={stats.wins} />
        <MetricCard label="Процент побед" value={pct(stats.winRate)} />
        <MetricCard label="Поражения / ничьи" value={`${stats.losses} / ${stats.draws}`} />
        <MetricCard label="Завершённые игры" value={stats.completedGames} />
        <MetricCard label="Подходы / дротики" value={`${stats.visits} / ${stats.physicalDarts}`} />
        <MetricCard label="Raw очки" value={stats.rawPoints} />
        <MetricCard label="Зачётные очки" value={stats.awardedPoints} />
      </div>
      <div className="thresholds" aria-label="Высокие подходы">
        {(['60+', '80+', '100+', '120+', '140+', '180'] as const).map((key) => (
          <Metric key={key} label={key} value={stats.thresholds[key]} />
        ))}
      </div>
      <details className="stat-section">
        <summary>X01 аналитика</summary>
        <div className="metric-grid">
          <MetricCard label="First 9 Average" value={number(x01.first9Average)} />
          <MetricCard
            label="Checkout"
            value={`${x01.successfulCheckouts} / ${x01.checkoutAttempts} · ${pct(x01.checkoutPercent)}`}
          />
          <MetricCard label="Лучший checkout" value={x01.highestCheckout || '—'} />
          <MetricCard label="Bust" value={`${x01.busts} · ${pct(x01.bustRate)}`} />
          <MetricCard label="Даблы" value={`${x01.doubleHits} / ${x01.doubleAttempts}`} />
          <MetricCard label="Остаток после 9" value={x01.averageRemainingAfter[9]?.toFixed(0) ?? '—'} />
        </div>
        {Object.keys(x01.doubles).length ? (
          <p className="stats-note">
            {Object.entries(x01.doubles)
              .map(([double, value]) => `${double} — ${value.hits} / ${value.attempts}`)
              .join(' · ')}
          </p>
        ) : (
          <p className="stats-note">Попадания по конкретным даблам появятся при вводе подходов по дротикам.</p>
        )}
      </details>
      {stats.matches < 2 ? (
        <p className="stats-note">
          Пока мало данных для динамики. Уже доступные показатели рассчитаны по сыгранным броскам.
        </p>
      ) : null}
    </section>
  );
}

function Hits({ stats }: { stats: PlayerHistoryStatistics }) {
  const [kind, setKind] = useState<'S' | 'D' | 'T'>('S');
  const frequent = (prefix: 'S' | 'D' | 'T') => {
    const labels = Array.from({ length: 20 }, (_, index) => `${prefix}${index + 1}`),
      best = labels.reduce(
        (current, key) => ((stats.hitCounts[key] ?? 0) > (stats.hitCounts[current] ?? 0) ? key : current),
        labels[0]!,
      );
    return (stats.hitCounts[best] ?? 0) > 0 ? best : '—';
  };
  return (
    <section className="stat-section">
      <div className="hit-share-grid">
        <MetricCard
          label="Одиночные"
          value={`${stats.singles} · ${pct(percentage(stats.singles, stats.knownHitDarts))}`}
        />
        <MetricCard
          label="Удвоения"
          value={`${stats.doubles} · ${pct(percentage(stats.doubles, stats.knownHitDarts))}`}
        />
        <MetricCard
          label="Утроения"
          value={`${stats.triples} · ${pct(percentage(stats.triples, stats.knownHitDarts))}`}
        />
        <MetricCard
          label="25"
          value={`${stats.outerBulls} · ${pct(percentage(stats.outerBulls, stats.knownHitDarts))}`}
        />
        <MetricCard label="Bull" value={`${stats.bulls} · ${pct(percentage(stats.bulls, stats.knownHitDarts))}`} />
        <MetricCard label="Промахи" value={`${stats.misses} · ${pct(percentage(stats.misses, stats.knownHitDarts))}`} />
      </div>
      <p className="stats-insight">
        Самое частое одиночное попадание: {frequent('S')}; больше всего утроений: {frequent('T')}.
      </p>
      <div className="stats-tabs compact" aria-label="Тип сектора">
        {(['S', 'D', 'T'] as const).map((key) => (
          <button key={key} className={kind === key ? 'selected' : ''} onClick={() => setKind(key)}>
            {key === 'S' ? 'Одиночные' : key === 'D' ? 'Удвоения' : 'Утроения'}
          </button>
        ))}
      </div>
      <div className="sector-grid">
        {Array.from({ length: 20 }, (_, index) => {
          const label = `${kind}${index + 1}`,
            count = stats.hitCounts[label] ?? 0;
          return (
            <div key={label} className="sector-cell">
              <b>{label}</b>
              <span>{count}</span>
            </div>
          );
        })}
      </div>
      <div className="position-grid">
        {stats.positions.map((position, index) => (
          <article key={index}>
            <h3>Дротик {index + 1}</h3>
            <Metric label="Среднее" value={number(position.average)} />
            <Metric label="Промахи" value={pct(position.missPercent)} />
            <Metric label="Утроения" value={pct(position.triplePercent)} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Distribution({ stats }: { stats: PlayerHistoryStatistics }) {
  const maximum = Math.max(1, ...Object.values(stats.distribution));
  return (
    <section className="stat-section">
      <h3>Результаты подходов</h3>
      <div className="bar-chart">
        {distributionKeys.map((key) => (
          <div key={key} className="bar-row">
            <span>{key}</span>
            <div>
              <i style={{ width: `${(stats.distribution[key] / maximum) * 100}%` }} />
            </div>
            <b>{stats.distribution[key]}</b>
          </div>
        ))}
      </div>
      <p className="stats-note">
        <b>Разброс результатов: {number(stats.resultSpread)}</b>
        <br />
        Чем меньше значение, тем стабильнее результаты подходов.
      </p>
    </section>
  );
}

function Trends({
  matches,
  playerId,
  mode,
  period,
}: {
  matches: readonly Match[];
  playerId: PlayerId;
  mode: StatisticsMode;
  period: StatisticsPeriod;
}) {
  const [metric, setMetric] = useState<TrendMetric>('threeDartAverage'),
    points = trendForPlayer(matches, playerId, metric, mode, period),
    maximum = Math.max(1, ...points.map((point) => point.value));
  return (
    <section className="stat-section">
      <label className="trend-select">
        Показатель
        <select value={metric} onChange={(event) => setMetric(event.target.value as TrendMetric)}>
          {(Object.keys(trendLabels) as TrendMetric[]).map((key) => (
            <option key={key} value={key}>
              {trendLabels[key]}
            </option>
          ))}
        </select>
      </label>
      {points.length < 2 ? (
        <p className="stats-note">Пока мало игр для динамики.</p>
      ) : (
        <div className="trend-chart" aria-label={trendLabels[metric]}>
          {points.map((point, index) => (
            <div key={point.matchId} className="trend-column">
              <b>{number(point.value)}</b>
              <i style={{ height: `${Math.max(4, (point.value / maximum) * 100)}%` }} />
              <span>{index + 1}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Records({
  matches,
  playerId,
  mode,
  statsResetAt,
}: {
  matches: readonly Match[];
  playerId: PlayerId;
  mode: StatisticsMode;
  statsResetAt?: string;
}) {
  const records = recordsForPlayer(matches, playerId, mode, statsResetAt);
  return (
    <section className="stat-section">
      <div className="record-list">
        <MetricCard label="Лучший подход" value={records.bestVisit} />
        <MetricCard label="Лучшее среднее за 3 дротика" value={number(records.bestThreeDartAverage)} />
        <MetricCard
          label="100+ / 140+ / 180 за матч"
          value={`${records.most100Plus} / ${records.most140Plus} / ${records.most180s}`}
        />
        <MetricCard label="Утроения / Bull за матч" value={`${records.mostTriples} / ${records.mostBulls}`} />
        <MetricCard
          label="Минимальная доля промахов"
          value={records.lowestMissPercent === undefined ? '—' : pct(records.lowestMissPercent)}
        />
      </div>
      <p className="stats-note">
        Процентный рекорд учитывается минимум после {MIN_PERCENT_RECORD_DARTS} физических дротиков в матче.
      </p>
    </section>
  );
}

function Comparison({
  matches,
  matchesByPlayer,
  players,
  initialPlayerIds,
  mode,
  onMode,
  onClose,
  onPlayer,
}: {
  matches: readonly Match[];
  matchesByPlayer: ReadonlyMap<PlayerId, readonly Match[]>;
  players: readonly Player[];
  initialPlayerIds: readonly PlayerId[];
  mode: StatisticsMode;
  onMode: (value: StatisticsMode) => void;
  onClose: () => void;
  onPlayer: (id: PlayerId) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<readonly PlayerId[]>(() => {
    const contextual = [...new Set(initialPlayerIds)].filter((id) => players.some((player) => player.id === id));
    return (contextual.length >= 2 ? contextual : players.slice(0, 2).map((player) => player.id)).slice(0, 8);
  });
  const selected = useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const player = players.find((item) => item.id === id);
        return player
          ? [
              {
                player,
                stats: statisticsForPlayerHistory(matchesByPlayer.get(id) ?? [], id, mode, 'all', player.statsResetAt),
              },
            ]
          : [];
      }),
    [matchesByPlayer, mode, players, selectedIds],
  );
  const toggle = (id: PlayerId) =>
    setSelectedIds((current) => {
      if (current.includes(id)) return current.length <= 2 ? current : current.filter((item) => item !== id);
      return current.length >= 8 ? current : [...current, id];
    });
  const pair = selected.length === 2 ? selected : undefined;
  const meetings = pair
    ? headToHead(
        matchesByPlayer.get(pair[0]!.player.id) ?? matches,
        pair[0]!.player.id,
        pair[1]!.player.id,
        mode,
        pair[0]!.player.statsResetAt,
      )
    : undefined;
  return (
    <section className="comparison">
      <button className="stats-back" onClick={onClose}>
        ← К игрокам
      </button>
      <h2>Сравнение игроков</h2>
      <fieldset className="comparison-roster">
        <legend>Участники сравнения · {selected.length} из 8</legend>
        <div>
          {players.map((player) => {
            const checked = selectedIds.includes(player.id);
            return (
              <button
                key={player.id}
                type="button"
                className={checked ? 'selected' : ''}
                aria-pressed={checked}
                disabled={!checked && selected.length >= 8}
                onClick={() => toggle(player.id)}
              >
                <span aria-hidden="true">{checked ? '✓' : '+'}</span>
                <PlayerIdentity playerId={player.id} name={player.name} compact />
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="comparison-toolbar">
        <label>
          Режим игры
          <select value={mode} onChange={(event) => onMode(event.target.value as StatisticsMode)}>
            {(Object.keys(modeLabels) as StatisticsMode[]).map((key) => (
              <option key={key} value={key}>
                {modeLabels[key]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selected.length < 2 ? (
        <p className="stats-note">Выберите минимум двух игроков.</p>
      ) : (
        <>
          <div className="comparison-grid" aria-label={`Сравнение ${selected.length} игроков`}>
            {selected.map(({ player, stats }) => (
              <ComparisonPlayer key={player.id} player={player} stats={stats} all={selected} onOpen={onPlayer} />
            ))}
          </div>
          {pair && meetings ? (
            <article className="head-to-head">
              <h3>Личные встречи</h3>
              <strong>
                {pair[0]!.player.name} {meetings.playerAWins} : {meetings.playerBWins} {pair[1]!.player.name}
              </strong>
              <span>
                Дуэлей: {meetings.sharedMatches} · Ничьи: {meetings.draws}
              </span>
              {meetings.excludedMultiPlayerMatches ? (
                <span>Матчи с 3+ игроками не входят в H2H: {meetings.excludedMultiPlayerMatches}</span>
              ) : null}
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}

type ComparedPlayer = Readonly<{ player: Player; stats: PlayerHistoryStatistics }>;
const primaryComparisonMetrics = [
  { label: 'Матчи', value: (stats: PlayerHistoryStatistics) => stats.matches },
  { label: 'Победы', value: (stats: PlayerHistoryStatistics) => stats.wins },
  { label: 'Процент побед', value: (stats: PlayerHistoryStatistics) => stats.winRate, percent: true },
  { label: 'Среднее за 3 дротика', value: (stats: PlayerHistoryStatistics) => stats.threeDartAverage },
  { label: 'Лучший подход', value: (stats: PlayerHistoryStatistics) => stats.bestVisit },
] as const;
const secondaryComparisonMetrics = [
  { label: 'Среднее за дротик', value: (stats: PlayerHistoryStatistics) => stats.averagePerDart },
  { label: '100+', value: (stats: PlayerHistoryStatistics) => stats.thresholds['100+'] },
  { label: '140+', value: (stats: PlayerHistoryStatistics) => stats.thresholds['140+'] },
  { label: '180', value: (stats: PlayerHistoryStatistics) => stats.thresholds['180'] },
  {
    label: 'Доля утроений',
    value: (stats: PlayerHistoryStatistics) => percentage(stats.triples, stats.knownHitDarts),
    percent: true,
  },
  {
    label: 'Доля удвоений',
    value: (stats: PlayerHistoryStatistics) => percentage(stats.doubles, stats.knownHitDarts),
    percent: true,
  },
  {
    label: 'Промахи',
    value: (stats: PlayerHistoryStatistics) => percentage(stats.misses, stats.knownHitDarts),
    percent: true,
    lowerIsBetter: true,
  },
] as const;

function ComparisonPlayer({
  player,
  stats,
  all,
  onOpen,
}: {
  player: Player;
  stats: PlayerHistoryStatistics;
  all: readonly ComparedPlayer[];
  onOpen: (id: PlayerId) => void;
}) {
  return (
    <article className="comparison-player">
      <button className="comparison-profile-link" onClick={() => onOpen(player.id)}>
        <PlayerIdentity playerId={player.id} name={player.name} compact />
        <span>Открыть профиль</span>
      </button>
      <div className="comparison-metrics">
        {primaryComparisonMetrics.map((metric) => (
          <ComparedMetric key={metric.label} metric={metric} stats={stats} all={all} />
        ))}
      </div>
      <details>
        <summary>Другие показатели</summary>
        <div className="comparison-metrics secondary-metrics">
          {secondaryComparisonMetrics.map((metric) => (
            <ComparedMetric key={metric.label} metric={metric} stats={stats} all={all} />
          ))}
        </div>
      </details>
    </article>
  );
}

type MetricDefinition = Readonly<{
  label: string;
  value: (stats: PlayerHistoryStatistics) => number;
  percent?: boolean;
  lowerIsBetter?: boolean;
}>;
function ComparedMetric({
  metric,
  stats,
  all,
}: {
  metric: MetricDefinition;
  stats: PlayerHistoryStatistics;
  all: readonly ComparedPlayer[];
}) {
  const value = metric.value(stats);
  const values = all.map((item) => metric.value(item.stats));
  const leader = metric.lowerIsBetter ? value === Math.min(...values) : value === Math.max(...values);
  return (
    <span>
      <small>{metric.label}</small>
      <b>{metric.percent ? pct(value) : Number.isInteger(value) ? String(value) : number(value)}</b>
      {leader && all.length > 1 ? <em>Лидер</em> : null}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="metric">
      <small>{label}</small>
      <b>{value}</b>
    </span>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}
