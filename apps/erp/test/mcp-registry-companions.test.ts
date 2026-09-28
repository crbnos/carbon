import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULE_LIST,
  mcpServerCompanionModules
} from "../../../scripts/lib/service-metadata";

// The generator publishes every `{mod}.mcp.server.ts` export (shadowing a
// same-named service function), while the runtime registry only dispatches to
// what it statically imports. When the two disagree, the manifest describes a
// route command but a call resolves to the bare primitive — the class of bug
// where a tool "succeeds" and skips the orchestration the UI runs. This pins
// the generator's companion list to the registry's imports and spread order.

const REGISTRY = readFileSync(
  join(__dirname, "../app/routes/api+/v1+/lib/registry.server.ts"),
  "utf8"
);

function registryCompanionModules(): string[] {
  return [
    ...REGISTRY.matchAll(
      /import \* as (\w+) from "~\/modules\/(\w+)\/\2\.mcp\.server";/g
    )
  ]
    .map((m) => m[2]!)
    .sort();
}

describe("mcp.server companions", () => {
  it("the registry imports exactly the companions the generator parses", () => {
    expect(registryCompanionModules()).toEqual(
      [...mcpServerCompanionModules()].sort()
    );
  });

  it("every companion spreads AFTER its service namespace, so it shadows", () => {
    for (const mod of mcpServerCompanionModules()) {
      const imported = REGISTRY.match(
        new RegExp(
          `import \\* as (\\w+) from "~/modules/${mod}/${mod}\\.mcp\\.server";`
        )
      )?.[1];
      const service = REGISTRY.match(
        new RegExp(
          `import \\* as (\\w+) from "~/modules/${mod}/${mod}(?:\\.ee)?\\.service";`
        )
      )?.[1];
      expect(imported, `${mod} companion import`).toBeDefined();
      expect(service, `${mod} service import`).toBeDefined();
      expect(REGISTRY).toContain(
        `${mod}: { ...${service}, ...${imported} }`
      );
    }
  });

  it("every generator module is in the registry", () => {
    for (const mod of MODULE_LIST) {
      expect(REGISTRY).toMatch(new RegExp(`\\n  ${mod}: `));
    }
  });
});
