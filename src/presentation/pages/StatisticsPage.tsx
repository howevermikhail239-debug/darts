import { useMemo, useState } from "react";
import type { Match, Player, PlayerId } from "../../domain/match/models";
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
} from "../../domain/statistics/StatisticsCalculator";

type Section = "overview" | "hits" | "distribution" | "trends" | "records";
const modeLabels: Record<StatisticsMode, string> = { all: "Все", x01: "X01", fixed_visits: "Набор очков" };
const periodLabels: Record<StatisticsPeriod, string> = { 5: "Последние 5", 10: "Последние 10", 20: "Последние 20", all: "Всё время" };
const trendLabels: Record<TrendMetric, string> = { threeDartAverage: "Среднее за 3 дротика", bestVisit: "Лучший подход", missPercent: "Промахи, %", triplePercent: "Доля утроений, %", "100Plus": "100+ за игру" };
const pct = (value: number) => `${value.toFixed(1)}%`;
const number = (value: number) => value.toFixed(1);

type Props = { matches: readonly Match[]; players: readonly Player[]; initialPlayerIds?: readonly PlayerId[]; onBack: () => void };
export function StatisticsPage({ matches, players, initialPlayerIds = [], onBack }: Props) {
  const available = players;
  const relevant = initialPlayerIds.filter((id) => available.some((player) => player.id === id));
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId | undefined>(() => relevant.length === 1 ? relevant[0] : undefined);
  const [compare, setCompare] = useState(() => relevant.length >= 2);
  const [mode, setMode] = useState<StatisticsMode>("all");
  const [period, setPeriod] = useState<StatisticsPeriod>("all");
  const selected = available.find((player) => player.id === selectedPlayerId);
  return <main className="statistics-page">
    <header className="stats-header"><button className="text-icon" onClick={onBack} aria-label="Назад">‹</button><div><h1>Статистика</h1><p>Только подтверждённые броски</p></div></header>
    {available.length === 0 ? <p className="empty">Здесь появится накопительная статистика профилей. Временные участники остаются доступны в истории матчей.</p>
      : compare ? <Comparison matches={matches} players={available} initialPlayerIds={relevant} mode={mode} onMode={setMode} onClose={() => setCompare(false)} />
      : selected ? <PlayerDetails matches={matches} player={selected} mode={mode} period={period} onMode={setMode} onPeriod={setPeriod} onClose={() => setSelectedPlayerId(undefined)} />
      : <Overview matches={matches} players={available} onSelect={setSelectedPlayerId} onCompare={() => setCompare(true)} />}
  </main>;
}

function Overview({ matches, players, onSelect, onCompare }: { matches: readonly Match[]; players: readonly Player[]; onSelect: (id: PlayerId) => void; onCompare: () => void }) {
  return <><section className="stats-player-grid" aria-label="Игроки">{players.map((player) => { const stats = statisticsForPlayerHistory(matches, player.id); return <button key={player.id} className="stats-player-card" onClick={() => onSelect(player.id)}><strong>{player.name}</strong><Metric label="Среднее за 3 дротика" value={number(stats.threeDartAverage)} /><Metric label="Лучший подход" value={stats.bestVisit} /><Metric label="Победы" value={pct(stats.winRate)} /><Metric label="180" value={stats.thresholds["180"]} /></button>; })}</section>
    {players.length >= 2 ? <button className="primary stats-compare-action" onClick={onCompare}>Сравнить игроков</button> : null}</>;
}

function Filters({ mode, period, onMode, onPeriod }: { mode: StatisticsMode; period: StatisticsPeriod; onMode: (value: StatisticsMode) => void; onPeriod: (value: StatisticsPeriod) => void }) {
  return <section className="stats-filters" aria-label="Фильтры статистики"><label>Режим<select value={mode} onChange={(event) => onMode(event.target.value as StatisticsMode)}>{(Object.keys(modeLabels) as StatisticsMode[]).map((key) => <option key={key} value={key}>{modeLabels[key]}</option>)}</select></label><label>Период<select value={period} onChange={(event) => onPeriod(event.target.value === "all" ? "all" : Number(event.target.value) as 5 | 10 | 20)}>{([5, 10, 20, "all"] as const).map((key) => <option key={key} value={key}>{periodLabels[key]}</option>)}</select></label></section>;
}

function PlayerDetails({ matches, player, mode, period, onMode, onPeriod, onClose }: { matches: readonly Match[]; player: Player; mode: StatisticsMode; period: StatisticsPeriod; onMode: (value: StatisticsMode) => void; onPeriod: (value: StatisticsPeriod) => void; onClose: () => void }) {
  const [section, setSection] = useState<Section>("overview");
  const stats = useMemo(() => statisticsForPlayerHistory(matches, player.id, mode, period), [matches, player.id, mode, period]);
  return <><button className="stats-back" onClick={onClose}>← Все игроки</button><h2 className="stats-player-title">{player.name}</h2><Filters mode={mode} period={period} onMode={onMode} onPeriod={onPeriod} />
    <nav className="stats-tabs" aria-label="Раздел статистики">{(["overview", "hits", "distribution", "trends", "records"] as const).map((key) => <button key={key} className={section === key ? "selected" : ""} onClick={() => setSection(key)}>{({ overview: "Обзор", hits: "Попадания", distribution: "Распределение", trends: "Динамика", records: "Рекорды" } as const)[key]}</button>)}</nav>
    {section === "overview" ? <PlayerOverview stats={stats} /> : section === "hits" ? <Hits stats={stats} /> : section === "distribution" ? <Distribution stats={stats} /> : section === "trends" ? <Trends matches={matches} playerId={player.id} mode={mode} period={period} /> : <Records matches={matches} playerId={player.id} mode={mode} />}
  </>;
}

function PlayerOverview({ stats }: { stats: PlayerHistoryStatistics }) {
  return <section className="stat-section"><div className="metric-grid"><MetricCard label="Среднее за 3 дротика" value={number(stats.threeDartAverage)} /><MetricCard label="Среднее за дротик" value={number(stats.averagePerDart)} /><MetricCard label="Лучший подход" value={stats.bestVisit} /><MetricCard label="Победы / поражения" value={`${stats.wins} / ${stats.losses} · ${pct(stats.winRate)}`} /><MetricCard label="Завершённые игры" value={stats.completedGames} /><MetricCard label="Подходы / дротики" value={`${stats.visits} / ${stats.physicalDarts}`} /><MetricCard label="Raw очки" value={stats.rawPoints} /><MetricCard label="Зачётные очки" value={stats.awardedPoints} /></div><div className="thresholds" aria-label="Высокие подходы">{(["60+", "80+", "100+", "120+", "140+", "180"] as const).map((key) => <Metric key={key} label={key} value={stats.thresholds[key]} />)}</div>{stats.matches < 2 ? <p className="stats-note">Пока мало данных для динамики. Уже доступные показатели рассчитаны по сыгранным броскам.</p> : null}</section>;
}

function Hits({ stats }: { stats: PlayerHistoryStatistics }) {
  const [kind, setKind] = useState<"S" | "D" | "T">("S");
  const frequent = (prefix: "S" | "D" | "T") => { const labels = Array.from({ length: 20 }, (_, index) => `${prefix}${index + 1}`), best = labels.reduce((current, key) => (stats.hitCounts[key] ?? 0) > (stats.hitCounts[current] ?? 0) ? key : current, labels[0]!); return (stats.hitCounts[best] ?? 0) > 0 ? best : "—"; };
  return <section className="stat-section"><div className="hit-share-grid"><MetricCard label="Одиночные" value={`${stats.singles} · ${pct(percentage(stats.singles, stats.knownHitDarts))}`} /><MetricCard label="Удвоения" value={`${stats.doubles} · ${pct(percentage(stats.doubles, stats.knownHitDarts))}`} /><MetricCard label="Утроения" value={`${stats.triples} · ${pct(percentage(stats.triples, stats.knownHitDarts))}`} /><MetricCard label="25" value={`${stats.outerBulls} · ${pct(percentage(stats.outerBulls, stats.knownHitDarts))}`} /><MetricCard label="Bull" value={`${stats.bulls} · ${pct(percentage(stats.bulls, stats.knownHitDarts))}`} /><MetricCard label="Промахи" value={`${stats.misses} · ${pct(percentage(stats.misses, stats.knownHitDarts))}`} /></div><p className="stats-insight">Самое частое одиночное попадание: {frequent("S")}; больше всего утроений: {frequent("T")}.</p><div className="stats-tabs compact" aria-label="Тип сектора">{(["S", "D", "T"] as const).map((key) => <button key={key} className={kind === key ? "selected" : ""} onClick={() => setKind(key)}>{key === "S" ? "Одиночные" : key === "D" ? "Удвоения" : "Утроения"}</button>)}</div><div className="sector-grid">{Array.from({ length: 20 }, (_, index) => { const label = `${kind}${index + 1}`, count = stats.hitCounts[label] ?? 0; return <div key={label} className="sector-cell"><b>{label}</b><span>{count}</span></div>; })}</div><div className="position-grid">{stats.positions.map((position, index) => <article key={index}><h3>Дротик {index + 1}</h3><Metric label="Среднее" value={number(position.average)} /><Metric label="Промахи" value={pct(position.missPercent)} /><Metric label="Утроения" value={pct(position.triplePercent)} /></article>)}</div></section>;
}

function Distribution({ stats }: { stats: PlayerHistoryStatistics }) {
  const maximum = Math.max(1, ...Object.values(stats.distribution));
  return <section className="stat-section"><h3>Результаты подходов</h3><div className="bar-chart">{distributionKeys.map((key) => <div key={key} className="bar-row"><span>{key}</span><div><i style={{ width: `${stats.distribution[key] / maximum * 100}%` }} /></div><b>{stats.distribution[key]}</b></div>)}</div><p className="stats-note"><b>Разброс результатов: {number(stats.resultSpread)}</b><br />Чем меньше значение, тем стабильнее результаты подходов.</p></section>;
}

function Trends({ matches, playerId, mode, period }: { matches: readonly Match[]; playerId: PlayerId; mode: StatisticsMode; period: StatisticsPeriod }) {
  const [metric, setMetric] = useState<TrendMetric>("threeDartAverage"), points = trendForPlayer(matches, playerId, metric, mode, period), maximum = Math.max(1, ...points.map((point) => point.value));
  return <section className="stat-section"><label className="trend-select">Показатель<select value={metric} onChange={(event) => setMetric(event.target.value as TrendMetric)}>{(Object.keys(trendLabels) as TrendMetric[]).map((key) => <option key={key} value={key}>{trendLabels[key]}</option>)}</select></label>{points.length < 2 ? <p className="stats-note">Пока мало игр для динамики.</p> : <div className="trend-chart" aria-label={trendLabels[metric]}>{points.map((point, index) => <div key={point.matchId} className="trend-column"><b>{number(point.value)}</b><i style={{ height: `${Math.max(4, point.value / maximum * 100)}%` }} /><span>{index + 1}</span></div>)}</div>}</section>;
}

function Records({ matches, playerId, mode }: { matches: readonly Match[]; playerId: PlayerId; mode: StatisticsMode }) {
  const records = recordsForPlayer(matches, playerId, mode);
  return <section className="stat-section"><div className="record-list"><MetricCard label="Лучший подход" value={records.bestVisit} /><MetricCard label="Лучшее среднее за 3 дротика" value={number(records.bestThreeDartAverage)} /><MetricCard label="100+ / 140+ / 180 за матч" value={`${records.most100Plus} / ${records.most140Plus} / ${records.most180s}`} /><MetricCard label="Утроения / Bull за матч" value={`${records.mostTriples} / ${records.mostBulls}`} /><MetricCard label="Минимальная доля промахов" value={records.lowestMissPercent === undefined ? "—" : pct(records.lowestMissPercent)} /></div><p className="stats-note">Процентный рекорд учитывается минимум после {MIN_PERCENT_RECORD_DARTS} физических дротиков в матче.</p></section>;
}

function Comparison({ matches, players, initialPlayerIds, mode, onMode, onClose }: { matches: readonly Match[]; players: readonly Player[]; initialPlayerIds: readonly PlayerId[]; mode: StatisticsMode; onMode: (value: StatisticsMode) => void; onClose: () => void }) {
  const [a, setA] = useState(initialPlayerIds[0] ?? players[0]?.id ?? ""), [b, setB] = useState(initialPlayerIds[1] ?? players[1]?.id ?? players[0]?.id ?? "");
  const playerA = players.find((player) => player.id === a), playerB = players.find((player) => player.id === b);
  const statsA = statisticsForPlayerHistory(matches, a, mode), statsB = statisticsForPlayerHistory(matches, b, mode), meetings = headToHead(matches, a, b, mode);
  return <section className="comparison"><button className="stats-back" onClick={onClose}>← К игрокам</button><h2>Сравнение игроков</h2><div className="comparison-selects"><label>Игрок A<select value={a} onChange={(event) => setA(event.target.value)}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>Игрок B<select value={b} onChange={(event) => setB(event.target.value)}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>Режим<select value={mode} onChange={(event) => onMode(event.target.value as StatisticsMode)}>{(Object.keys(modeLabels) as StatisticsMode[]).map((key) => <option key={key} value={key}>{modeLabels[key]}</option>)}</select></label></div>{a === b ? <p className="stats-note">Выберите двух разных игроков.</p> : <><div className="comparison-list">{[["Завершённые игры", statsA.completedGames, statsB.completedGames], ["Победы", statsA.wins, statsB.wins], ["Процент побед", statsA.winRate, statsB.winRate, true], ["Среднее за 3 дротика", statsA.threeDartAverage, statsB.threeDartAverage], ["Среднее за дротик", statsA.averagePerDart, statsB.averagePerDart], ["Лучший подход", statsA.bestVisit, statsB.bestVisit], ["100+", statsA.thresholds["100+"], statsB.thresholds["100+"]], ["140+", statsA.thresholds["140+"], statsB.thresholds["140+"]], ["180", statsA.thresholds["180"], statsB.thresholds["180"]], ["Доля утроений", percentage(statsA.triples, statsA.knownHitDarts), percentage(statsB.triples, statsB.knownHitDarts), true], ["Доля удвоений", percentage(statsA.doubles, statsA.knownHitDarts), percentage(statsB.doubles, statsB.knownHitDarts), true], ["Промахи", percentage(statsA.misses, statsA.knownHitDarts), percentage(statsB.misses, statsB.knownHitDarts), true, true]].map(([label, valueA, valueB, percent, lowerIsBetter]) => <ComparisonRow key={String(label)} label={String(label)} nameA={playerA?.name ?? "A"} nameB={playerB?.name ?? "B"} valueA={Number(valueA)} valueB={Number(valueB)} percent={Boolean(percent)} lowerIsBetter={Boolean(lowerIsBetter)} />)}</div><article className="head-to-head"><h3>Личные встречи</h3><strong>{playerA?.name} {meetings.playerAWins} : {meetings.playerBWins} {playerB?.name}</strong><span>Совместных матчей: {meetings.sharedMatches}</span><span>Победы других игроков: {meetings.otherPlayerWins}</span></article></>}</section>;
}

function ComparisonRow({ label, nameA, nameB, valueA, valueB, percent, lowerIsBetter }: { label: string; nameA: string; nameB: string; valueA: number; valueB: number; percent: boolean; lowerIsBetter: boolean }) { const format = (value: number) => percent ? pct(value) : Number.isInteger(value) ? String(value) : number(value); const aBetter = lowerIsBetter ? valueA < valueB : valueA > valueB, bBetter = lowerIsBetter ? valueB < valueA : valueB > valueA; return <article className="comparison-row"><h3>{label}</h3><div><span><small>{nameA}</small><b>{format(valueA)}</b>{aBetter ? <em>Лучше</em> : null}</span><span><small>{nameB}</small><b>{format(valueB)}</b>{bBetter ? <em>Лучше</em> : null}</span></div></article>; }

function Metric({ label, value }: { label: string; value: string | number }) {
  return <span className="metric"><small>{label}</small><b>{value}</b></span>;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return <article className="metric-card"><small>{label}</small><strong>{value}</strong></article>;
}
