import { useCallback, useSyncExternalStore } from "react";
import { clearAppUpdate, pendingAppUpdate, subscribeToAppUpdate } from "../pwa/appUpdate";

/**
 * Возвращает `apply`, если готова новая версия приложения (REL-3).
 * Пока обновления нет — `undefined`, и плашка не показывается.
 */
export function useAppUpdate(): { available: boolean; apply: () => void } {
  const pending = useSyncExternalStore(subscribeToAppUpdate, pendingAppUpdate, () => undefined);
  const apply = useCallback(() => {
    const action = pendingAppUpdate();
    clearAppUpdate();
    action?.();
  }, []);
  return { available: Boolean(pending), apply };
}
