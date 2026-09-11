/**
 * Хранилище ожидающего обновления приложения (REL-3).
 *
 * `src/main.tsx` регистрирует service worker и, когда новая версия готова,
 * передаёт сюда функцию применения обновления. Интерфейс подписывается на это
 * хранилище через `useAppUpdate()` и показывает плашку «Доступна новая версия».
 * Обновление применяется ТОЛЬКО по явному нажатию пользователя.
 *
 * Модуль намеренно не знает ни про `virtual:pwa-register`, ни про сам
 * service worker: в тестовой среде он просто остаётся пустым.
 */
export type ApplyUpdate = () => void;

type Listener = () => void;

let pending: ApplyUpdate | undefined;
const listeners = new Set<Listener>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

/** Вызывается из `main.tsx` в колбэке `onNeedRefresh`. */
export function announceAppUpdate(apply: ApplyUpdate): void {
  pending = apply;
  notify();
}

/** Сбрасывает ожидающее обновление (используется после применения и в тестах). */
export function clearAppUpdate(): void {
  if (!pending) return;
  pending = undefined;
  notify();
}

export function pendingAppUpdate(): ApplyUpdate | undefined {
  return pending;
}

export function subscribeToAppUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
