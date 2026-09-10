import type { PlayerId } from "../../domain/match/models";

export const PLAYER_PALETTE = ["amber", "sky", "mint", "violet", "rose", "teal", "sand", "blue"] as const;

export function playerMonogram(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length > 1) return `${Array.from(words[0]!)[0] ?? ""}${Array.from(words[1]!)[0] ?? ""}`.toLocaleUpperCase("ru-RU");
  return Array.from(words[0]!).slice(0, 2).join("").toLocaleUpperCase("ru-RU");
}

export function persistentPlayerPaletteIndex(playerId: PlayerId): number {
  let hash = 2166136261;
  for (const character of playerId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % PLAYER_PALETTE.length;
}

export function playerVisual(playerId: PlayerId, temporary: boolean, position: number) {
  const paletteIndex = temporary ? position % PLAYER_PALETTE.length : persistentPlayerPaletteIndex(playerId);
  return { paletteIndex, tone: PLAYER_PALETTE[paletteIndex]! };
}
