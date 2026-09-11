import type { ExternalActiveMatchChange } from '../application/ports/repositories';

/**
 * Тонкая обёртка над BroadcastChannel: оповещает другие вкладки этого же браузера об
 * изменении активного матча. BroadcastChannel может отсутствовать (старый Safari) —
 * тогда обёртка молча превращается в no-op, а приложение продолжает работать.
 */
export const TAB_CHANNEL_NAME = 'dart-scorekeeper';

type Listener = (event: ExternalActiveMatchChange) => void;

const isChange = (value: unknown): value is ExternalActiveMatchChange => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.kind === 'saved' || candidate.kind === 'cleared') && typeof candidate.revision === 'number';
};

export class TabChannel {
  private channel: BroadcastChannel | undefined;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly name: string = TAB_CHANNEL_NAME) {}

  get supported(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  }

  private open(): BroadcastChannel | undefined {
    if (!this.supported) return undefined;
    if (!this.channel) {
      const channel = new BroadcastChannel(this.name);
      channel.onmessage = (event: MessageEvent) => {
        if (!isChange(event.data)) return;
        for (const listener of [...this.listeners]) listener(event.data);
      };
      // В Node BroadcastChannel удерживает цикл событий; в браузере метода нет.
      (channel as unknown as { unref?: () => void }).unref?.();
      this.channel = channel;
    }
    return this.channel;
  }

  post(event: ExternalActiveMatchChange): void {
    try {
      this.open()?.postMessage(event);
    } catch {
      // Вещание — вспомогательная функция: её отказ не должен ломать запись в хранилище.
    }
  }

  subscribe(listener: Listener): () => void {
    this.open();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  close(): void {
    this.channel?.close();
    this.channel = undefined;
  }
}

export const tabChannel = new TabChannel();
