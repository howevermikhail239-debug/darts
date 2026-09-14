import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../src/presentation/pages/SettingsPage';
import { HistoryPage } from '../src/presentation/pages/HistoryPage';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match, Player } from '../src/domain/match/models';
import { StatisticsPage } from '../src/presentation/pages/StatisticsPage';

const at = '2026-09-07T12:00:00.000Z';
const settingsProps = {
  onRename: vi.fn(async () => undefined),
  onResetStatistics: vi.fn(async () => undefined),
  onDeletePlayer: vi.fn(async () => undefined),
  onBack: vi.fn(),
  onExport: vi.fn(async () => '{}'),
  onRestore: vi.fn(async () => undefined),
  hapticsSupported: false,
  hapticsEnabled: false,
  onHaptics: vi.fn(async () => undefined),
};

const completed = (index: number): Match => ({
  ...createMatch(
    `m${index}`,
    ['a', 'b'],
    { mode: 'fixed_visits', visitsPerPlayer: 1, startingPlayerIndex: 0 },
    `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    { a: 'Миша', b: 'Саша' },
  ),
  status: 'completed',
  completedAt: at,
  winnerId: 'a',
});

afterEach(cleanup);

describe('settings name fields follow incoming players (UI-2)', () => {
  it('picks up a renamed profile but keeps what the user is typing', () => {
    const players: Player[] = [{ id: 'a', name: 'Миша', createdAt: at }];
    const { rerender } = render(<SettingsPage players={players} {...settingsProps} />);

    expect(screen.getByLabelText('Имя')).toHaveValue('Миша');

    rerender(<SettingsPage players={[{ id: 'a', name: 'Михаил', createdAt: at }]} {...settingsProps} />);
    expect(screen.getByLabelText('Имя')).toHaveValue('Михаил');

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Мих' } });
    rerender(<SettingsPage players={[{ id: 'a', name: 'Михаил', createdAt: at }]} {...settingsProps} />);
    expect(screen.getByLabelText('Имя')).toHaveValue('Мих');
  });
});

describe('history list (PERF-7, UI-3)', () => {
  const historyProps = {
    persistentPlayerIds: ['a', 'b'],
    onBack: vi.fn(),
    onRematch: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
  };

  it('loads the history page by page instead of rendering everything at once', () => {
    const matches = Array.from({ length: 25 }, (_, index) => completed(index));
    render(<HistoryPage matches={matches} players={[]} {...historyProps} />);

    expect(screen.getAllByRole('group')).toHaveLength(20);
    expect(screen.getByText('Показано 20 из 25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));

    expect(screen.getAllByRole('group')).toHaveLength(25);
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  it('keeps the name from the match and explains the current profile name', () => {
    render(
      <HistoryPage matches={[completed(0)]} players={[{ id: 'a', name: 'Михаил', createdAt: at }]} {...historyProps} />,
    );

    expect(screen.getByText('Миша (сейчас Михаил) — Саша')).toBeInTheDocument();
    expect(screen.getByText('Победитель: Миша (сейчас Михаил)')).toBeInTheDocument();
  });
});

describe('statistics overview and multi-player comparison', () => {
  const players: Player[] = Array.from({ length: 8 }, (_, index) => ({
    id: `p${index + 1}`,
    name: index === 7 ? 'Игрок с очень длинным именем номер восемь' : `Игрок ${index + 1}`,
    createdAt: at,
  }));
  const multi: Match = {
    ...createMatch(
      'multi',
      players.map((player) => player.id),
      { mode: 'fixed_visits', visitsPerPlayer: 1, startingPlayerIndex: 0 },
      at,
      Object.fromEntries(players.map((player) => [player.id, player.name])),
    ),
    status: 'completed',
    completedAt: at,
    winnerId: 'p3',
  };

  it('shows total matches, absolute wins, and the existing percentage independently', () => {
    render(<StatisticsPage matches={[multi]} players={players.slice(0, 3)} onBack={() => undefined} />);
    const winner = screen.getByRole('button', { name: /Игрок 3/ });
    expect(within(winner).getByText('Всего матчей').nextSibling).toHaveTextContent('1');
    expect(within(winner).getByText('Всего побед').nextSibling).toHaveTextContent('1');
    expect(within(winner).getByText('Процент побед').nextSibling).toHaveTextContent('100.0%');
  });

  it('compares eight players in readable per-player rows and keeps two-player H2H available', () => {
    const { rerender } = render(
      <StatisticsPage
        matches={[multi]}
        players={players}
        initialPlayerIds={players.map((player) => player.id)}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Сравнение 8 игроков').querySelectorAll('.comparison-player')).toHaveLength(8);
    expect(screen.getByText('Участники сравнения · 8 из 8')).toBeInTheDocument();
    expect(screen.getAllByText('Матчи')).toHaveLength(8);
    expect(screen.getAllByText('Победы')).toHaveLength(8);
    expect(screen.getAllByText('Процент побед')).toHaveLength(8);

    rerender(
      <StatisticsPage
        matches={[multi]}
        players={players}
        initialPlayerIds={players.slice(0, 2).map((player) => player.id)}
        onBack={() => undefined}
      />,
    );
    // A remount is needed because the comparison deliberately owns the user's live selection.
    cleanup();
    render(
      <StatisticsPage
        matches={[multi]}
        players={players}
        initialPlayerIds={players.slice(0, 2).map((player) => player.id)}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Личные встречи' })).toBeInTheDocument();
  });
});
