import { describe, expect, it, vi } from "vitest";
import { createMatch } from "../src/domain/match/createMatch";
import type { Match, Player } from "../src/domain/match/models";
import { prepareRematch } from "../src/application/PrepareRematch";
import { PLAYER_PALETTE, persistentPlayerPaletteIndex, playerMonogram, playerVisual } from "../src/presentation/players/playerVisuals";
import { toSummaryViewModel } from "../src/presentation/game/summaryViewModel";
import { vibrateFor } from "../src/presentation/feedback/haptics";

const at = "2026-09-10T12:00:00.000Z";
const player = (id: string, name = id): Player => ({ id, name, createdAt: at });
const completed = (count: number, starter = 0): Match => ({
  ...createMatch("old-match", Array.from({ length: count }, (_, index) => `p${index}`), { mode: "fixed_visits", visitsPerPlayer: 3, startingPlayerIndex: starter }, at),
  status: "completed",
  completedAt: at,
  winnerId: "p0",
});

describe("Stage 4.5 player visuals", () => {
  it("builds readable Cyrillic, Latin, one-word, two-word and edge-case monograms", () => {
    expect(playerMonogram("Михаил")).toBe("МИ");
    expect(playerMonogram("Александра Долженко")).toBe("АД");
    expect(playerMonogram("mike stone")).toBe("MS");
    expect(playerMonogram("Я")).toBe("Я");
    expect(playerMonogram("   ")).toBe("—");
  });

  it("keeps persistent colors stable independently of match position", () => {
    const id = "persistent-misha";
    expect(playerVisual(id, false, 0).paletteIndex).toBe(playerVisual(id, false, 7).paletteIndex);
    expect(persistentPlayerPaletteIndex(id)).toBeLessThan(PLAYER_PALETTE.length);
    expect(new Set(["persistent-misha", "persistent-sasha", "persistent-zhenya"].map(persistentPlayerPaletteIndex)).size).toBeGreaterThan(1);
  });

  it("assigns temporary colors by their position inside one match", () => {
    expect(playerVisual("temp-any", true, 0).paletteIndex).toBe(0);
    expect(playerVisual("temp-any", true, 3).paletteIndex).toBe(3);
  });
});

describe("Stage 4.5 rematch configuration", () => {
  it.each([2, 3, 5, 8])("rotates the starting player for %i participants", (count) => {
    const source = completed(count, count - 1);
    expect(prepareRematch(source, source.players.map((id) => player(id))).setup.startingPlayerIndex).toBe(0);
  });

  it("preserves mode/options and stable local/shared identities while recreating temporary participants", () => {
    const source: Match = { ...createMatch("old", ["local", "shared", "temp-old"], { mode: "x01", startingScore: 701, outRule: "double", format: { kind: "limited", visitsPerPlayer: 9 }, startingPlayerIndex: 1 }, at, { local: "Миша", shared: "Саша", "temp-old": "Игрок 3" }), status: "completed", completedAt: at, winnerId: "local" };
    const request = prepareRematch(source, [player("local", "Миша"), player("shared", "Саша")]);
    expect(request.setup).toEqual({ mode: "x01", startingScore: 701, outRule: "double", format: { kind: "limited", visitsPerPlayer: 9 }, startingPlayerIndex: 2 });
    expect(request.participants).toEqual([{ name: "Миша", playerId: "local" }, { name: "Саша", playerId: "shared" }, { name: "Игрок 3" }]);
  });
});

describe("Stage 4.5 summary and haptics", () => {
  it("maps a persistent winner without inventing facts", () => {
    const view = toSummaryViewModel(completed(2), [player("p0", "Миша"), player("p1", "Саша")]);
    expect(view).toMatchObject({ title: "Миша победил", winner: { playerId: "p0", temporary: false }, maximums: 0 });
    expect(view.facts.map((fact) => fact.label)).toEqual(["Средний набор победителя", "Лучший подход матча", "Подходов сыграно"]);
  });

  it("maps a tie and a temporary winner as match-local identity", () => {
    const source = completed(2);
    const tie: Match = { id: source.id, createdAt: source.createdAt, completedAt: source.completedAt!, status: source.status, players: source.players, participantNames: source.participantNames, startingPlayerIndex: source.startingPlayerIndex, currentPlayerIndex: source.currentPlayerIndex, confirmedVisits: source.confirmedVisits, state: source.state };
    expect(toSummaryViewModel(tie, [])).toMatchObject({ title: "Ничья", maximums: 0 });
    expect(toSummaryViewModel(completed(2), [])).toMatchObject({ winner: { temporary: true } });
  });

  it("uses event-specific vibration and safely falls back without the API", () => {
    const vibrate = vi.fn(() => true);
    expect(vibrateFor("confirm", true, { vibrate })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(18);
    expect(vibrateFor("bust", true, undefined)).toBe(false);
    expect(vibrateFor("win", false, { vibrate })).toBe(false);
  });
});
