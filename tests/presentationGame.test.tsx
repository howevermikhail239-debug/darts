import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePage } from '../src/presentation/pages/GamePage';
import { GameSession } from '../src/application/GameSession';
import type { ActiveMatchRecord, MatchRepository } from '../src/application/ports/repositories';
import { createMatch } from '../src/domain/match/createMatch';

const at = '2026-09-07T12:00:00.000Z';
const players = [
  { id: 'a', name: 'Миша', createdAt: at },
  { id: 'b', name: 'Саша', createdAt: at },
];

/** Репозиторий, запись в который завершается только по команде теста. */
class GatedRepository implements MatchRepository {
  private release: (() => void) | undefined;
  saveActive(_record: ActiveMatchRecord): Promise<void> {
    void _record;
    return new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  async loadActive(): Promise<ActiveMatchRecord | undefined> {
    return undefined;
  }
  async archiveAndClearActive(): Promise<void> {
    /* не нужен в этом тесте */
  }
  async listHistory(): Promise<readonly []> {
    return [];
  }
  async finishWrite(): Promise<void> {
    const release = this.release;
    this.release = undefined;
    await act(async () => {
      release?.();
    });
  }
}

const renderGame = () => {
  const repository = new GatedRepository();
  const match = createMatch(
    'm1',
    ['a', 'b'],
    { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
    at,
  );
  const session = new GameSession(
    match,
    repository,
    () => 'visit',
    () => at,
  );
  render(
    <GamePage
      session={session}
      initial={session.snapshot()}
      players={players}
      previousMatches={[]}
      onChange={() => undefined}
      onBack={() => undefined}
      onClosed={() => undefined}
      onStatistics={async () => undefined}
      onRematch={async () => undefined}
      persistentPlayerIds={['a', 'b']}
      hapticsEnabled={false}
    />,
  );
  return { repository };
};

describe('dart pad during a pending write (CLI-3)', () => {
  afterEach(cleanup);

  it('stays locked while the draft is being written, even when a slot is selected for replacement', async () => {
    const { repository } = renderGame();

    fireEvent.click(screen.getByRole('button', { name: 'Сектор 20, множитель 1' }));
    expect(screen.getByRole('button', { name: 'Сектор 5, множитель 1' })).toBeDisabled();
    await repository.finishWrite();
    expect(screen.getByRole('button', { name: 'Сектор 5, множитель 1' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Дротик 1: S20, заменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сектор 19, множитель 1' }));

    // Раньше панель оставалась активной при выбранном слоте, и второе нажатие
    // давало ложное «Подтверждение уже выполняется», теряя бросок.
    expect(screen.getByRole('button', { name: 'Сектор 5, множитель 1' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();

    await repository.finishWrite();
    expect(screen.getByRole('button', { name: 'Дротик 1: S19, заменить' })).toBeInTheDocument();
  });

  it('does not lose a throw that was pressed while the previous write was still running', async () => {
    const { repository } = renderGame();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Сектор 20, множитель 1' }));
    await repository.finishWrite();
    fireEvent.click(screen.getByRole('button', { name: 'Дротик 1: S20, заменить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сектор 19, множитель 1' }));
    await repository.finishWrite();

    expect(screen.getByRole('button', { name: 'Дротик 1: S19, заменить' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    logged.mockRestore();
  });
});
