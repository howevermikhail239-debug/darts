import { describe, expect, it } from "vitest";
import type { CompanyGateway } from "../src/application/ports/companyGateway";
import { HttpCompanyGateway } from "../src/infrastructure/network/HttpCompanyGateway";

const sources = import.meta.glob("../src/**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;
const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)].map((match) => match[1]!);

const resolveTarget = (file: string, target: string): string => {
  if (!target.startsWith(".")) return target;
  const segments = [...file.split("/").slice(0, -1), ...target.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
};
const adapterOf = (path: string): string | undefined => /(?:^|\/)infrastructure\/([^/]+)\/[^/]+$/.exec(path)?.[1];
/** Импорты между подкаталогами инфраструктуры: network не должен знать о persistence и наоборот. */
const crossAdapterImports = (entries: readonly (readonly [string, string])[]): string[] =>
  entries.flatMap(([file, source]) => {
    const adapter = adapterOf(file);
    if (adapter === undefined) return [];
    return importsOf(source)
      .map((target) => resolveTarget(file, target))
      .filter((target) => {
        const targetAdapter = /(?:^|\/)infrastructure\/([^/]+)\//.exec(target)?.[1];
        return targetAdapter !== undefined && targetAdapter !== adapter;
      })
      .map((target) => `${file} -> ${target}`);
  });

describe("architecture boundaries", () => {
  it("keeps domain independent from upper layers and React", () => {
    const violations = Object.entries(sources)
      .filter(([file]) => file.includes("/domain/"))
      .flatMap(([file, source]) => importsOf(source)
        .filter((target) => /(?:^|\/)(application|infrastructure|presentation|app)(?:\/|$)/.test(target) || target === "react")
        .map((target) => `${file} -> ${target}`));
    expect(violations).toEqual([]);
  });

  it("keeps application independent from infrastructure, presentation, React, and fetch", () => {
    const applicationSources = Object.entries(sources).filter(([file]) => file.includes("/application/"));
    const importViolations = applicationSources.flatMap(([file, source]) => importsOf(source)
      .filter((target) => /(?:^|\/)(infrastructure|presentation|app)(?:\/|$)/.test(target) || target === "react")
      .map((target) => `${file} -> ${target}`));
    const fetchViolations = applicationSources.filter(([, source]) => /\bfetch\s*\(/.test(source)).map(([file]) => file);
    expect(importViolations).toEqual([]);
    expect(fetchViolations).toEqual([]);
  });

  it("keeps infrastructure adapters from importing each other", () => {
    expect(crossAdapterImports(Object.entries(sources))).toEqual([]);
  });

  it("fails when an adapter reaches into another adapter", () => {
    const violations = crossAdapterImports([
      ["../src/infrastructure/network/HttpCompanyGateway.ts", "import { isMatch } from '../persistence/IndexedDbRepositories';"],
      ["../src/infrastructure/persistence/IndexedDbRepositories.ts", "import { HttpCompanyGateway } from '../network/HttpCompanyGateway';"],
    ]);
    expect(violations).toEqual([
      "../src/infrastructure/network/HttpCompanyGateway.ts -> src/infrastructure/persistence/IndexedDbRepositories",
      "../src/infrastructure/persistence/IndexedDbRepositories.ts -> src/infrastructure/network/HttpCompanyGateway",
    ]);
  });

  it("validates matches through the single domain validator, not a storage decoder", () => {
    const gateway = sources["../src/infrastructure/network/HttpCompanyGateway.ts"] ?? "";
    const storage = sources["../src/infrastructure/persistence/IndexedDbRepositories.ts"] ?? "";
    expect(gateway).toContain("domain/match/validation");
    expect(storage).toContain("domain/match/validation");
    expect(storage).not.toMatch(/export function isMatch/);
  });

  it("wires the HTTP adapter to the application CompanyGateway port", () => {
    const gateway: CompanyGateway = new HttpCompanyGateway();
    expect(gateway).toBeInstanceOf(HttpCompanyGateway);
    expect(sources["../src/infrastructure/network/HttpCompanyGateway.ts"]).toContain("implements CompanyGateway");
  });
});
