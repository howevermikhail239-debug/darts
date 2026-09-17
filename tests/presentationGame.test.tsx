import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamePage } from '../src/presentation/pages/GamePage';
import { GameSession } from '../src/application/GameSession';
import type { ActiveMatchRecord, MatchRepository } from '../src/application/ports/repositories';
import { createMatch } from '../src/domain/match/createMatch';
import { numberThrow } from '../src/domain/darts/DartThrow';

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

class ImmediateRepository implements MatchRepository {
  async saveActive(): Promise<void> {}
  async loadActive(): Promise<ActiveMatchRecord | undefined> {
    return undefined;
  }
  async archiveAndClearActive(): Promise<void> {}
  async listHistory(): Promise<readonly []> {
    return [];
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

describe('confirmed visit undo', () => {
  afterEach(cleanup);

  it('names the player and score while keeping current-draft editing actions distinct', async () => {
    const match = createMatch(
      'undo-match',
      ['a', 'b'],
      { mode: 'fixed_visits', visitsPerPlayer: 3, startingPlayerIndex: 0 },
      at,
      { a: 'Миша', b: 'Саша' },
    );
    const session = new GameSession(
      match,
      new ImmediateRepository(),
      () => crypto.randomUUID(),
      () => at,
    );
    await session.record(numberThrow(20, 3));
    await session.record(numberThrow(5, 1));
    await session.record(numberThrow(1, 1));
    await session.confirm();
    const initial = session.snapshot();

    render(
      <GamePage
        session={session}
        initial={initial}
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

    expect(screen.getByText('Последний подтверждённый ход')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отменить подтверждённый ход Миша — 66' })).toHaveTextContent(
      'Отменить ход Миша — 66',
    );
    expect(screen.getByText('Броски: T20 · S5 · S1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить текущий дротик' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Сбросить текущий подход' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить подтверждённый ход Миша — 66' }));
    await waitFor(() => expect(screen.queryByText('Последний подтверждённый ход')).not.toBeInTheDocument());
    expect(screen.queryByText('Пока нет хода для отмены')).not.toBeInTheDocument();
  });
});
