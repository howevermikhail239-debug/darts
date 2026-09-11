import { useCallback, useEffect, useState } from "react";
import type { SettingsRepository } from "../../application/ports/repositories";

export function usePreferences(settings: SettingsRepository) {
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  useEffect(() => {
    let current = true;
    void settings.load()
      .then((values) => { if (current) setHapticsEnabledState(values.haptics !== "off"); })
      // Настройки не критичны: при отказе остаются значения по умолчанию.
      .catch((cause: unknown) => console.error("Не удалось прочитать настройки устройства:", cause));
    return () => { current = false; };
  }, [settings]);
  const setHapticsEnabled = useCallback(async (enabled: boolean) => {
    setHapticsEnabledState(enabled);
    try {
      const values = await settings.load();
      await settings.save({ ...values, haptics: enabled ? "on" : "off" });
    } catch (cause) {
      setHapticsEnabledState(!enabled);
      throw cause;
    }
  }, [settings]);
  return { hapticsEnabled, setHapticsEnabled };
}
