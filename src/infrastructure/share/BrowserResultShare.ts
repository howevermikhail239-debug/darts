import type { ResultShareCard } from '../../application/PrepareResultShare';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';
type ShareNavigator = Pick<Navigator, 'share' | 'canShare'>;

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
  context.stroke();
}

const playerAccents = ['#51bd8b', '#809ee3', '#d487d1', '#e6b45f', '#65b8d3', '#df7f78', '#9bc56c', '#b498e1'];
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` : (parts[0]?.slice(0, 2) ?? '?')
  ).toLocaleUpperCase('ru-RU');
}

export async function generateResultCard(card: ResultShareCard): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не поддерживает создание изображения');
  const gradient = context.createLinearGradient(0, 0, 1080, 1080);
  gradient.addColorStop(0, '#132236');
  gradient.addColorStop(1, '#070d16');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1080);
  context.fillStyle = '#e9822a';
  context.fillRect(72, 70, 8, 84);
  context.fillStyle = '#f5f7fb';
  context.font = '800 38px system-ui';
  context.fillText(card.brand, 108, 110);
  context.fillStyle = '#9babc0';
  context.font = '500 24px system-ui';
  context.fillText(card.date, 108, 150);
  context.fillStyle = '#f5f7fb';
  context.font = '900 72px system-ui';
  context.fillText(card.title, 72, 265, 936);
  const rowHeight = Math.min(112, 400 / Math.max(2, card.participants.length));
  card.participants.forEach((participant, index) => {
    const y = 326 + index * (rowHeight + 12);
    context.fillStyle = participant.winner ? '#25344a' : '#111c2a';
    context.strokeStyle = participant.winner ? '#e9822a' : '#304259';
    context.lineWidth = participant.winner ? 3 : 2;
    roundedRect(context, 72, y, 936, rowHeight, 18);
    const accent = playerAccents[index % playerAccents.length]!;
    context.beginPath();
    context.arc(126, y + rowHeight / 2, 30, 0, Math.PI * 2);
    context.fillStyle = accent;
    context.fill();
    context.fillStyle = '#07121d';
    context.font = '900 19px system-ui';
    context.textAlign = 'center';
    context.fillText(monogram(participant.name), 126, y + rowHeight / 2 + 7);
    context.textAlign = 'left';
    context.fillStyle = '#f5f7fb';
    context.font = '750 32px system-ui';
    context.fillText(participant.name, 176, y + rowHeight / 2 + 11, 610);
    context.fillStyle = participant.winner ? '#f3ad70' : '#d7e0eb';
    context.font = '900 42px system-ui';
    context.textAlign = 'right';
    context.fillText(String(participant.result), 970, y + rowHeight / 2 + 14);
    context.textAlign = 'left';
  });
  const factsY = Math.max(710, 350 + card.participants.length * (rowHeight + 12));
  context.fillStyle = '#9babc0';
  context.font = '700 22px system-ui';
  context.fillText('ГЛАВНЫЕ ФАКТЫ', 72, factsY);
  card.facts.forEach((fact, index) => {
    const y = factsY + 58 + index * 74;
    context.fillStyle = '#9babc0';
    context.font = '500 23px system-ui';
    context.fillText(fact.label, 72, y);
    context.fillStyle = '#f5f7fb';
    context.font = '800 29px system-ui';
    context.fillText(fact.value, 420, y, 588);
  });
  context.fillStyle = '#e9822a';
  context.font = '700 22px system-ui';
  context.fillText('Играйте. Считайте. Запоминайте лучшие матчи.', 72, 1010);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Не удалось создать PNG'))), 'image/png'),
  );
  return new File([blob], `dart-result-${Date.now()}.png`, { type: 'image/png' });
}

export async function deliverResultFile(
  file: File,
  target: ShareNavigator = navigator,
  download: (file: File) => void = downloadFile,
): Promise<ShareOutcome> {
  const data: ShareData = { files: [file], title: 'Результат матча — Dart Scorekeeper' };
  if (typeof target.share === 'function' && target.canShare?.(data)) {
    try {
      await target.share(data);
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
      throw cause;
    }
  }
  download(file);
  return 'downloaded';
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function shareResultCard(card: ResultShareCard): Promise<ShareOutcome> {
  return deliverResultFile(await generateResultCard(card));
}
