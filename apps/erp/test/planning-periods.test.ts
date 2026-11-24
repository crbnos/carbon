// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import type { ModulePermissions } from "@carbon/api/permissions";
import { type Actor, createServiceContext } from "@carbon/api/service-fn.server";
import { getPlanningPeriods } from "../app/modules/shared/shared.server";

// The read adds missing weeks to the calendar as the system, so a caller the
// planning screens would turn away must be refused before anything runs.
const untouched = new Proxy(
  {},
  {
    get(_, key) {
      throw new Error(`Nothing should be read or written (${String(key)})`);
    }
  }
);

const viewOf = (...modules: string[]): ModulePermissions =>
  Object.fromEntries(
    modules.map((module) => [
      module,
      { view: ["company-1"], create: [], update: [], delete: [] }
    ])
  );

const read = (actor: Actor) =>
  getPlanningPeriods(
    createServiceContext({
      actor,
      company: { id: "company-1", groupId: "group-1" },
      caller: untouched as never,
      system: () => untouched as never,
      pg: () => untouched as never,
      kv: () => untouched as never
    }),
    { locationId: "loc-1" }
  );

describe("getPlanningPeriods", () => {
  it("refuses a user who can view no planning screen", async () => {
    const { error } = await read({
      type: "user",
      userId: "user-1",
      permissions: viewOf("sales")
    });
    expect(error?.category).toBe("forbidden");
  });

  it("refuses an API key that can view no planning screen", async () => {
    const { error } = await read({
      type: "apiKey",
      createdBy: "user-1",
      scopes: viewOf("sales")
    });
    expect(error?.category).toBe("forbidden");
  });

  it.each(["production", "purchasing", "parts"])(
    "lets a %s viewer past the refusal",
    async (module) => {
      const { error } = await read({
        type: "user",
        userId: "user-1",
        permissions: viewOf(module)
      });
      expect(error?.category).not.toBe("forbidden");
    }
  );
});
