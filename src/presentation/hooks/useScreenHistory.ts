import { useCallback, useEffect, useRef, useState } from "react";

export type Screen = "home" | "game" | "history" | "statistics" | "settings";

const SCREENS: readonly Screen[] = ["home", "game", "history", "statistics", "settings"];
const isScreen = (value: unknown): value is Screen => typeof value === "string" && SCREENS.includes(value as Screen);
const historyState = (): Record<string, unknown> => {
  const state = window.history.state as unknown;
  return state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
};

/**
 * Экран + история навигации (CLI-1).
 *
 * Аппаратная кнопка «Назад» в установленном PWA должна возвращать на предыдущий
 * экран, а не закрывать приложение. Полноценный маршрутизатор не нужен: адрес
 * страницы не меняется (в нём живёт токен компании, см. `useCompanySync`),
 * меняется только `history.state.screen`.
 */
export function useScreenHistory(initial: Screen = "home") {
  const [screen, setScreen] = useState<Screen>(initial);
  const current = useRef<Screen>(initial);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { screen?: unknown } | null;
      const next = isScreen(state?.screen) ? state.screen : "home";
      current.current = next;
      setScreen(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /** Переход вперёд: добавляет запись в историю, чтобы «Назад» вернул обратно. */
  const show = useCallback((next: Screen) => {
    if (current.current === next) return;
    window.history.replaceState({ ...historyState(), screen: current.current }, "");
    window.history.pushState({ ...historyState(), screen: next }, "");
    current.current = next;
    setScreen(next);
  }, []);

  /** Замена текущей записи: для исправлений состояния, а не для навигации. */
  const replace = useCallback((next: Screen) => {
    window.history.replaceState({ ...historyState(), screen: next }, "");
    current.current = next;
    setScreen(next);
  }, []);

  return { screen, show, replace };
}
