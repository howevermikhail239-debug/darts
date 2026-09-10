import { describe, expect, it } from "vitest";
import { createMatch } from "../src/domain/match/createMatch";
import type { Match, Player } from "../src/domain/match/models";
import { persistentParticipantsInMatch, persistentStatisticsPlayers } from "../src/presentation/statistics/statisticsCorpus";

const at = "2026-09-10T10:00:00.000Z";
const completed = (id: string, players: readonly string[], names: Readonly<Record<string, string>>): Match => ({
  ...createMatch(id, players, { mode: "fixed_visits", visitsPerPlayer: 1, startingPlayerIndex: 0 }, at, names),
  status: "completed",
  completedAt: at,
});

describe("statistics player corpus", () => {
  it("excludes every match-local temporary identity without deduplicating by display name", () => {
    const saved: readonly Player[] = [
      { id: "profile-a", name: "Миша", createdAt: at },
      { id: "profile-b", name: "Миша", createdAt: at },
    ];
    const matches = [
      completed("one", ["temp-1a", "temp-2a"], { "temp-1a": "Игрок 1", "temp-2a": "Игрок 2" }),
      completed("two", ["temp-1b", "temp-2b"], { "temp-1b": "Игрок 1", "temp-2b": "Игрок 2" }),
      completed("profiles", ["profile-a", "profile-b"], { "profile-a": "Миша", "profile-b": "Миша" }),
    ];

    expect(persistentStatisticsPlayers(saved, matches).map((player) => player.id)).toEqual(["profile-a", "profile-b"]);
    expect(persistentParticipantsInMatch(saved, matches[0]!)).toEqual([]);
    expect(persistentParticipantsInMatch(saved, matches[2]!)).toEqual(["profile-a", "profile-b"]);
  });
});
