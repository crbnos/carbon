import { describe, expect, it } from "vitest";
import {
  type CounterpartDecision,
  decideCounterpart,
  resolveOrCreateRemoteCounterpart
} from "./counterpart";
import type { RemoteCandidate } from "./counterpart-types";
import type { BaseProvider } from "./types";

function candidate(
  remoteId: string,
  fields: Partial<Omit<RemoteCandidate, "remoteId">> = {}
): RemoteCandidate {
  return { remoteId, ...fields };
}

describe("decideCounterpart", () => {
  it("creates when there are no candidates at all", () => {
    expect(decideCounterpart({ name: "Acme Bolts" }, [])).toEqual({
      action: "create",
      reason: "no-candidates"
    } satisfies CounterpartDecision);
  });

  it("creates when no candidate matches any key", () => {
    const result = decideCounterpart({ name: "Acme Bolts" }, [
      candidate("v1", { name: "Globex" })
    ]);
    expect(result).toEqual({ action: "create", reason: "no-candidates" });
  });

  it("links on a single name match", () => {
    const result = decideCounterpart({ name: "Acme Bolts" }, [
      candidate("v1", { name: "Acme Bolts" }),
      candidate("v2", { name: "Globex" })
    ]);
    expect(result).toEqual({ action: "link", remoteId: "v1", via: "name" });
  });

  it("matches names case-insensitively and ignores surrounding whitespace", () => {
    const result = decideCounterpart({ name: "  acme BOLTS " }, [
      candidate("v1", { name: "Acme Bolts" })
    ]);
    expect(result).toEqual({ action: "link", remoteId: "v1", via: "name" });
  });

  it("creates rather than guessing when two candidates share the name", () => {
    const result = decideCounterpart({ name: "Acme Bolts" }, [
      candidate("v1", { name: "Acme Bolts" }),
      candidate("v2", { name: "acme bolts" })
    ]);
    expect(result).toEqual({
      action: "create",
      reason: "ambiguous",
      rung: "name"
    });
  });

  it("prefers the carbon reference over every weaker key", () => {
    const result = decideCounterpart(
      { carbonReference: "carbon:sup_1", taxId: "TX-9", name: "Acme Bolts" },
      [
        candidate("v1", { carbonReference: "carbon:sup_1", name: "Old Name" }),
        candidate("v2", { taxId: "TX-9", name: "Acme Bolts" })
      ]
    );
    expect(result).toEqual({
      action: "link",
      remoteId: "v1",
      via: "carbonReference"
    });
  });

  it("prefers a tax-id match over a conflicting single name match", () => {
    const result = decideCounterpart({ taxId: "TX-9", name: "Acme Bolts" }, [
      candidate("v1", { taxId: "TX-9", name: "Acme Bolts Ltd" }),
      candidate("v2", { name: "Acme Bolts" })
    ]);
    expect(result).toEqual({ action: "link", remoteId: "v1", via: "taxId" });
  });

  it("does NOT fall through from an ambiguous strong key to a weaker one", () => {
    // Two candidates share the tax id; one of them also uniquely matches the
    // name. Falling through would link by the weaker evidence precisely when
    // the stronger evidence proved ambiguous.
    const result = decideCounterpart({ taxId: "TX-9", name: "Acme Bolts" }, [
      candidate("v1", { taxId: "TX-9", name: "Acme Bolts" }),
      candidate("v2", { taxId: "TX-9", name: "Globex" })
    ]);
    expect(result).toEqual({
      action: "create",
      reason: "ambiguous",
      rung: "taxId"
    });
  });

  it("skips a rung the local record has no value for", () => {
    const result = decideCounterpart({ taxId: null, name: "Acme Bolts" }, [
      candidate("v1", { taxId: null, name: "Acme Bolts" })
    ]);
    expect(result).toEqual({ action: "link", remoteId: "v1", via: "name" });
  });

  it("treats an empty or whitespace-only key as absent on every rung", () => {
    const result = decideCounterpart(
      { carbonReference: "", taxId: "   ", email: "", name: "Acme Bolts" },
      [candidate("v1", { carbonReference: "", taxId: "", name: "Acme Bolts" })]
    );
    expect(result).toEqual({ action: "link", remoteId: "v1", via: "name" });
  });

  it("links on email when name is absent", () => {
    const result = decideCounterpart({ email: "AP@acme.test" }, [
      candidate("v1", { email: "ap@acme.test" })
    ]);
    expect(result).toEqual({ action: "link", remoteId: "v1", via: "email" });
  });
});

describe("resolveOrCreateRemoteCounterpart", () => {
  function providerWith(
    candidates: RemoteCandidate[],
    searchable: string[] = ["vendor"]
  ) {
    let calls = 0;
    const provider = {
      capabilities: { searchableCounterparts: searchable },
      findRemoteCandidates: async () => {
        calls += 1;
        return candidates;
      }
    } as unknown as BaseProvider;
    return { provider, calls: () => calls };
  }

  it("short-circuits on an existing mapping without searching", async () => {
    const { provider, calls } = providerWith([candidate("v1", { name: "X" })]);
    const result = await resolveOrCreateRemoteCounterpart({
      provider,
      kind: "vendor",
      keys: { name: "X" },
      existingRemoteId: "already-mapped"
    });
    expect(result).toEqual({ remoteId: "already-mapped", decision: null });
    expect(calls()).toBe(0);
  });

  it("returns create without searching when the provider declares no search", async () => {
    const { provider, calls } = providerWith(
      [candidate("v1", { name: "Acme" })],
      []
    );
    const result = await resolveOrCreateRemoteCounterpart({
      provider,
      kind: "vendor",
      keys: { name: "Acme" },
      existingRemoteId: null
    });
    expect(result.remoteId).toBeNull();
    expect(result.decision).toEqual({
      action: "create",
      reason: "no-candidates"
    });
    expect(calls()).toBe(0);
  });

  it("does not search for a kind the provider did not declare", async () => {
    const { provider, calls } = providerWith(
      [candidate("v1", { name: "Acme" })],
      ["customer"]
    );
    const result = await resolveOrCreateRemoteCounterpart({
      provider,
      kind: "vendor",
      keys: { name: "Acme" },
      existingRemoteId: null
    });
    expect(result.remoteId).toBeNull();
    expect(calls()).toBe(0);
  });

  it("links to a searched candidate", async () => {
    const { provider } = providerWith([candidate("v1", { name: "Acme" })]);
    const result = await resolveOrCreateRemoteCounterpart({
      provider,
      kind: "vendor",
      keys: { name: "Acme" },
      existingRemoteId: null
    });
    expect(result.remoteId).toBe("v1");
    expect(result.decision).toEqual({
      action: "link",
      remoteId: "v1",
      via: "name"
    });
  });

  it("returns null remoteId when the search is ambiguous", async () => {
    const { provider } = providerWith([
      candidate("v1", { name: "Acme" }),
      candidate("v2", { name: "Acme" })
    ]);
    const result = await resolveOrCreateRemoteCounterpart({
      provider,
      kind: "vendor",
      keys: { name: "Acme" },
      existingRemoteId: null
    });
    expect(result.remoteId).toBeNull();
    expect(result.decision?.action).toBe("create");
  });
});
