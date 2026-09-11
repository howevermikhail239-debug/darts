import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../src/presentation/pages/SettingsPage';
import { HistoryPage } from '../src/presentation/pages/HistoryPage';
import { createMatch } from '../src/domain/match/createMatch';
import type { Match, Player } from '../src/domain/match/models';

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
