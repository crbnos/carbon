import { describe, expect, it } from "vitest";
import {
  CARBON_PROVIDER_NAME,
  extractConnections,
  isCarbonConnection,
  isConnectionLinked,
  linkedConnections,
  resolveConnectedProviderName
} from "./connection-status";

/**
 * The fixtures below are REAL responses captured from the Ramp sandbox on
 * 2026-09-25, not invented shapes.
 */

/** Before uninstall: Carbon holds the seat. */
const LINKED = {
  connections: [
    {
      id: "06c58d3c-a4d3-4f5e-b2f1-fd4b95822389",
      status: "linked",
      is_active: true,
      connection_type: "API",
      remote_provider_name: "Carbon",
      last_linked_at: "2026-08-28T05:13:43+00:00"
    }
  ]
};

/**
 * After `DELETE /accounting/connection` (204). The record SURVIVES, still
 * carrying the provider name — this tombstone is the whole reason the status
 * filter exists.
 */
const TOMBSTONE = {
  connections: [
    {
      id: "06c58d3c-a4d3-4f5e-b2f1-fd4b95822389",
      status: "unlinked",
      is_active: false,
      settings: null,
      connection_type: "API",
      remote_provider_name: "Carbon",
      last_linked_at: "2026-08-28T05:13:43+00:00"
    }
  ]
};

describe("isConnectionLinked", () => {
  it("accepts the three live statuses, case-insensitively", () => {
    for (const status of ["linked", "active", "connected", "LINKED"]) {
      expect(isConnectionLinked(status)).toBe(true);
    }
  });

  it("rejects the unlinked tombstone and absent statuses", () => {
    for (const status of ["unlinked", "disconnected", "", null, undefined]) {
      expect(isConnectionLinked(status)).toBe(false);
    }
  });
});

describe("extractConnections", () => {
  it("reads Ramp's own envelope, the data envelope, and a bare array", () => {
    expect(extractConnections(LINKED)).toHaveLength(1);
    expect(extractConnections({ data: [{ status: "linked" }] })).toHaveLength(
      1
    );
    expect(extractConnections([{ status: "linked" }])).toHaveLength(1);
  });

  it("yields nothing for shapes that carry no list", () => {
    for (const value of [null, undefined, {}, 42, "nope"]) {
      expect(extractConnections(value)).toEqual([]);
    }
  });
});

describe("resolveConnectedProviderName", () => {
  it("names the provider holding a LIVE connection", () => {
    expect(resolveConnectedProviderName(LINKED)).toBe("Carbon");
  });

  it("returns undefined for a deleted connection's tombstone", () => {
    // The bug this pins: without the status filter this returned "Carbon" for a
    // business with NO connection at all, so a push-only install would have
    // reported a ledger holder that had been disconnected.
    expect(linkedConnections(TOMBSTONE)).toEqual([]);
    expect(resolveConnectedProviderName(TOMBSTONE)).toBeUndefined();
  });

  it("skips a tombstone to find the live connection behind it", () => {
    // The realistic push-only state: Carbon disconnected, someone else linked.
    const mixed = {
      connections: [
        ...TOMBSTONE.connections,
        { status: "linked", remote_provider_name: "Rillet" }
      ]
    };
    expect(resolveConnectedProviderName(mixed)).toBe("Rillet");
  });

  it("returns undefined when a live connection names nobody", () => {
    expect(
      resolveConnectedProviderName({ connections: [{ status: "linked" }] })
    ).toBeUndefined();
  });
});

describe("isCarbonConnection", () => {
  it("identifies Carbon's own connection, case-insensitively", () => {
    expect(isCarbonConnection({ remote_provider_name: "Carbon" })).toBe(true);
    expect(isCarbonConnection({ remote_provider_name: "carbon" })).toBe(true);
    expect(CARBON_PROVIDER_NAME).toBe("Carbon");
  });

  it("rejects another system's connection and an unnamed one", () => {
    // The distinction `ensureRampConnection` refuses on: `POST /accounting/connection`
    // RETURNS THE INCUMBENT when the single seat is taken, so a provider-mode
    // install stored another system's connection id as its own and would later
    // have pushed masters into it — and deleted it on uninstall.
    expect(isCarbonConnection({ remote_provider_name: "Rillet" })).toBe(false);
    expect(isCarbonConnection({ remote_provider_name: "NetSuite" })).toBe(
      false
    );
    expect(isCarbonConnection({})).toBe(false);
    expect(isCarbonConnection({ remote_provider_name: null })).toBe(false);
  });

  it("separates the incumbent from Carbon's own in one live response", () => {
    // The exact sandbox state that produced the bug.
    const live = linkedConnections({
      connections: [
        {
          id: "06a4b305-674b-4770-b67b-c2a9597f1d43",
          status: "linked",
          remote_provider_name: "Rillet"
        },
        {
          id: "06c58d3c-a4d3-4f5e-b2f1-fd4b95822389",
          status: "unlinked",
          remote_provider_name: "Carbon"
        }
      ]
    });

    // Carbon's own is UNLINKED, so it is not in the live set at all: there is an
    // incumbent and no Carbon connection to adopt. That combination must refuse.
    expect(live.map((c) => c.remote_provider_name)).toEqual(["Rillet"]);
    expect(live.find(isCarbonConnection)).toBeUndefined();
    expect(live.find((c) => !isCarbonConnection(c))?.id).toBe(
      "06a4b305-674b-4770-b67b-c2a9597f1d43"
    );
  });
});

describe("what each mode must see to be healthy", () => {
  /**
   * `rampHealthcheck` asks two different questions depending on what Carbon owns.
   * These pin the predicates it composes; the mode branch itself lives in
   * `hooks.server.ts`.
   */
  const carbonLinked = {
    connections: [
      { id: "c1", status: "linked", remote_provider_name: "Carbon" }
    ]
  };
  const peerLinked = {
    connections: [
      { id: "p1", status: "linked", remote_provider_name: "Rillet" }
    ]
  };
  const allUnlinked = {
    connections: [
      { id: "p1", status: "unlinked", remote_provider_name: "Rillet" },
      { id: "c1", status: "unlinked", remote_provider_name: "Carbon" }
    ]
  };

  it("provider mode needs CARBON's own connection, not merely any", () => {
    // `linked.length > 0` passed while another system held the seat and Carbon
    // held nothing — a green badge over an install that owns no connection.
    expect(linkedConnections(carbonLinked).some(isCarbonConnection)).toBe(true);
    expect(linkedConnections(peerLinked).some(isCarbonConnection)).toBe(false);
    expect(linkedConnections(allUnlinked).some(isCarbonConnection)).toBe(false);
  });

  it("uninstall deletes only a connection that is Carbon's", () => {
    // The destructive case, observed live: a provider-mode install that had
    // adopted a peer's connection deleted it on uninstall.
    expect(linkedConnections(peerLinked).some(isCarbonConnection)).toBe(false);
    expect(
      linkedConnections(peerLinked).find((c) => !isCarbonConnection(c))
        ?.remote_provider_name
    ).toBe("Rillet");
    // Nothing linked at all ⇒ nothing to tear down.
    expect(linkedConnections(allUnlinked)).toEqual([]);
  });
});
