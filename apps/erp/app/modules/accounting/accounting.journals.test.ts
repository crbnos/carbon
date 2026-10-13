// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The settings barrel re-exports its UI, which pulls Lingui `msg` macros that
// vitest does not transform; the glossary evaluates them at module load.
// Nothing under test touches either.
vi.mock("~/modules/settings", () => ({ getNextSequence: vi.fn() }));
vi.mock("@carbon/content/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import { getJournalEntries } from "./accounting.service";

/** A query builder that records every filter call made on it. */
function recordingClient() {
  const calls: [string, ...unknown[]][] = [];
  const builder: any = new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === "then") return undefined;
        return (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
    }
  );
  return { client: { from: () => builder } as any, calls };
}

const listArgs = { search: null, status: null, limit: 25, offset: 0 };

describe("getJournalEntries", () => {
  it("hides Superseded journals when no status is asked for", async () => {
    const { client, calls } = recordingClient();
    await getJournalEntries(client, "C1", listArgs);
    expect(calls).toContainEqual(["neq", "status", "Superseded"]);
  });

  it("shows Superseded journals when the status param asks for them", async () => {
    const { client, calls } = recordingClient();
    await getJournalEntries(client, "C1", {
      ...listArgs,
      status: "Superseded"
    });
    expect(calls).toContainEqual(["eq", "status", "Superseded"]);
    expect(calls).not.toContainEqual(["neq", "status", "Superseded"]);
  });

  it("leaves the status to a table filter on status", async () => {
    const { client, calls } = recordingClient();
    await getJournalEntries(client, "C1", {
      ...listArgs,
      filters: [{ column: "status", operator: "eq", value: "Superseded" }]
    });
    expect(calls).not.toContainEqual(["neq", "status", "Superseded"]);
  });

  it("still hides them when a filter on another column has a value", async () => {
    const { client, calls } = recordingClient();
    await getJournalEntries(client, "C1", {
      ...listArgs,
      filters: [{ column: "sourceType", operator: "eq", value: "Manual" }]
    });
    expect(calls).toContainEqual(["neq", "status", "Superseded"]);
  });
});
