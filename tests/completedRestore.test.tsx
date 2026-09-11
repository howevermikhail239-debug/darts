import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { services } from '../src/app/compositionRoot';
import { clearLocalData } from '../src/infrastructure/persistence/IndexedDbRepositories';
import { createMatch } from '../src/domain/match/createMatch';
import { GameSession } from '../src/application/GameSession';
import { numberThrow } from '../src/domain/darts/DartThrow';

afterEach(async () => {
  cleanup();
  await clearLocalData();
});
describe('completed active match restore', () => {
  it('restores the result screen after reload and keeps final Undo', async () => {
    const createdAt = '2026-09-07T12:00:00.000Z';
    await services.players.save({ id: 'a', name: 'Михаил', createdAt });
    await services.players.save({ id: 'b', name: 'Александр', createdAt });
    const match = createMatch(
      'restore',
      ['a', 'b'],
      { mode: 'x01', format: { kind: 'unlimited' }, startingPlayerIndex: 0 },
      createdAt,
    );
    if (match.state.kind !== 'x01') throw new Error('test setup');
    const near = { ...match, state: { ...match.state, remaining: { a: 40, b: 501 } } };
    const session = new GameSession(
      near,
      services.matches,
      () => 'visit',
      () => '2026-09-07T12:01:00.000Z',
    );
    await session.record(numberThrow(20, 2));
    await session.confirm();
    render(<App />);
    // DATA-3: у завершённого матча карточка возобновления открывает итоги, а не «продолжает» игру.
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть итоги' }));
    expect(await screen.findByRole('heading', { name: 'Михаил победил' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить предыдущий подход' }));
    expect(await screen.findByText('Предыдущий подход отменён.')).toBeInTheDocument();
    expect(screen.getByText('40', { selector: '.main-score' })).toBeInTheDocument();
  });
});
