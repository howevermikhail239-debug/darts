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

  it("wires the HTTP adapter to the application CompanyGateway port", () => {
    const gateway: CompanyGateway = new HttpCompanyGateway();
    expect(gateway).toBeInstanceOf(HttpCompanyGateway);
    expect(sources["../src/infrastructure/network/HttpCompanyGateway.ts"]).toContain("implements CompanyGateway");
  });
});
