export type HapticEvent = "confirm" | "bust" | "maximum" | "win";

const patterns: Record<HapticEvent, number | readonly number[]> = {
  confirm: 18,
  bust: [22, 35, 22],
  maximum: [24, 28, 45],
  win: [35, 35, 70],
};

export function vibrateFor(event: HapticEvent, enabled: boolean, navigatorLike: Pick<Navigator, "vibrate"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!enabled || typeof navigatorLike?.vibrate !== "function") return false;
  try { return navigatorLike.vibrate(patterns[event] as VibratePattern); } catch { return false; }
}
