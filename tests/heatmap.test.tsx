import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DartboardHeatmap } from '../src/presentation/components/DartboardHeatmap';

describe('DartboardHeatmap', () => {
  it('renders standard board geometry and maps known hit frequencies', () => {
    const { container } = render(
      <DartboardHeatmap hitCounts={{ T20: 4, S20: 2, D20: 1, S1: 1, '25': 2, Bull: 1, MISS: 3 }} detailedDarts={14} />,
    );
    expect([...container.querySelectorAll('svg text')].map((node) => node.textContent)).toEqual([
      '20',
      '1',
      '18',
      '4',
      '13',
      '6',
      '10',
      '15',
      '2',
      '17',
      '3',
      '19',
      '7',
      '16',
      '8',
      '11',
      '14',
      '9',
      '12',
      '5',
    ]);
    const t20 = screen.getByText('T20 — 4 попаданий').parentElement!;
    const d20 = screen.getByText('D20 — 1 попаданий').parentElement!;
    expect(t20.getAttribute('fill')).not.toBe(d20.getAttribute('fill'));
    expect(screen.getAllByText('S20 — 2 попаданий')).toHaveLength(2);
    expect(screen.getByText('25 — 2 попаданий')).toBeInTheDocument();
    expect(screen.getByText('Bull — 1 попаданий')).toBeInTheDocument();
    expect(container.querySelector('title')?.textContent).not.toContain('MISS —');
    fireEvent.focus(t20);
    expect(screen.getByText('T20 — 4 попаданий', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Карта построена по 14 детализированным броскам · промахов: 3/)).toBeInTheDocument();
  });

  it('clears the active sector label on blur and pointer leave, including the bull circles (UI-1)', () => {
    const { container } = render(<DartboardHeatmap hitCounts={{ '25': 2, Bull: 1 }} detailedDarts={3} />);
    const view = within(container);
    const idle = 'Наведите или нажмите на сектор';
    const outer = view.getByText('25 — 2 попаданий').parentElement!;
    const bull = view.getByText('Bull — 1 попаданий').parentElement!;

    fireEvent.pointerEnter(outer);
    expect(view.getByText('25 — 2 попаданий', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.pointerLeave(outer);
    expect(view.getByText(idle)).toBeInTheDocument();

    fireEvent.focus(bull);
    expect(view.getByText('Bull — 1 попаданий', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.blur(bull);
    expect(view.getByText(idle)).toBeInTheDocument();
  });

  it('does not invent sectors for legacy aggregate visits', () => {
    render(<DartboardHeatmap hitCounts={{}} detailedDarts={0} />);
    expect(screen.getByText('Для тепловой карты пока нет детализированных бросков.')).toBeInTheDocument();
  });
});
