// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Constants } from "@carbon/database";
import { describe, expect, it } from "vitest";

// Permission claims are `<module>_<action>`, module lowercased.
const MODULES = new Set(
  Constants.public.Enums.module.map((module) => module.toLowerCase())
);

// These admit any member of the company. Widening who may run a posting is a
// review decision: add an entry only after one.
const OPEN_TO_ANY_MEMBER = [
  "inventory.issueMaterialPermission.jobCompleteMakeToOrder",
  "inventory.postPickingPermission",
  "inventory.postStockTransferPermission"
];

/** Each permission a rule can resolve to, named `<file>.<export>[.<value>]`. */
function leaves(name: string, rule: unknown): [string, unknown][] {
  if (rule && typeof rule === "object" && "by" in rule && "rules" in rule) {
    return Object.entries(rule.rules as Record<string, unknown>).map(
      ([value, leaf]) => [`${name}.${value}`, leaf]
    );
  }
  return [[name, rule]];
}

async function permissionExports() {
  const modules = import.meta.glob<Record<string, unknown>>(
    "../app/modules/*/*.service.ts"
  );
  const out: [string, unknown][] = [];
  for (const [path, load] of Object.entries(modules)) {
    const file = path.split("/").pop()?.replace(/\.service\.ts$/, "");
    for (const [name, rule] of Object.entries(await load())) {
      if (name.endsWith("Permission")) out.push(...leaves(`${file}.${name}`, rule));
    }
  }
  return out;
}

describe("posting permissions", () => {
  it("each requires a named module, is system-only, or is reviewed as open", async () => {
    const all = await permissionExports();
    const open = all
      .filter(
        ([, rule]) =>
          rule !== "system" &&
          Object.keys((rule ?? {}) as object).length === 0
      )
      .map(([name]) => name)
      .sort();
    expect(open).toEqual(OPEN_TO_ANY_MEMBER);
  }, 120_000);

  it("names only modules that exist, so no claim can satisfy a typo", async () => {
    const unknown = (await permissionExports()).flatMap(([name, rule]) =>
      rule === "system"
        ? []
        : Object.values(rule as Record<string, string | string[]>)
            .flat()
            .filter((module) => !MODULES.has(module))
            .map((module) => `${name}: ${module}`)
    );
    expect(unknown).toEqual([]);
  }, 120_000);
});
