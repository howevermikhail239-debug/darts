import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpCompanyGateway } from "../src/infrastructure/network/HttpCompanyGateway";
import { createMatch } from "../src/domain/match/createMatch";

const valid = createMatch("remote", ["a", "b"], { mode: "x01", format: { kind: "unlimited" }, startingPlayerIndex: 0 }, "2026-09-11T12:00:00.000Z");
const response = (match: unknown) => ({ group: { name: "Лига", createdAt: "2026-09-11T12:00:00.000Z" }, players: [], matches: [match] });
const corruptions: readonly (readonly [string, (match: typeof valid) => unknown])[] = [
  ["missing state", (match) => Object.fromEntries(Object.entries(match).filter(([key]) => key !== "state"))],
  ["unknown state", (match) => ({ ...match, state: { kind: "unknown" } })],
  ["invalid players", (match) => ({ ...match, players: [] })],
  ["invalid winner", (match) => ({ ...match, winnerId: "outsider" })],
  ["invalid current player", (match) => ({ ...match, currentPlayerIndex: 99 })],
  ["missing X01 remaining", (match) => ({ ...match, state: { ...match.state, remaining: { a: 501 } } })],
  ["unsupported schema", (match) => ({ ...match, state: { ...match.state, format: { kind: "future" } } })],
];

afterEach(() => vi.unstubAllGlobals());

describe("HttpCompanyGateway remote match validation", () => {
  it("accepts a complete match payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response(valid)), { status: 200 })));
    await expect(new HttpCompanyGateway().loadCompany("token")).resolves.toMatchObject({ matches: [{ id: "remote" }] });
  });

  it.each(corruptions)("rejects %s at the HTTP boundary", async (_label, corrupt) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response(corrupt(valid))), { status: 200 })));
    await expect(new HttpCompanyGateway().loadCompany("token")).rejects.toThrow("некорректные данные");
  });
});
