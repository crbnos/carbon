// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The DB boundary: the `companyIntegration` row, the vault RPC behind its
// secrets, and the mapped devices. getIntegration, resolveIntegrationSecrets and
// the HMAC check between it and the route run for real.
const db = vi.hoisted(() => ({
  integration: null as Record<string, unknown> | null,
  vault: {} as Record<string, unknown>,
  devices: [] as Record<string, unknown>[]
}));
// Env constants only: the real @carbon/auth barrel reaches Lingui macros that
// only compile under Vite's lingui plugin.
vi.mock("@carbon/auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SUPABASE_URL: "http://localhost"
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({
    rpc: async () => ({ data: db.vault, error: null }),
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: async () => ({
          data:
            table === "companyIntegration"
              ? db.integration
              : (db.devices.find((row) =>
                  Object.entries(filters).every(
                    ([column, value]) => row[column] === value
                  )
                ) ?? null),
          error: null
        })
      };
      return query;
    }
  })
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.sense.$companyId";

const SECRET = "whsec_test-secret";
const STATION = "758d41d3-2724-41a6-9465-cbc8f73c2642";

const statusChanged = (stationId = STATION) =>
  JSON.stringify({
    id: "f173e259-4c99-4bd2-a3ef-a4d7765d278c",
    type: "station.status_changed",
    data: { id: "event-1", device_id: stationId, status: "Idle" }
  });

function run(body: string, signature?: string | null) {
  const t = "1793226951";
  const header =
    signature === undefined
      ? `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`
      : signature;
  const headers = new Headers();
  if (header !== null) headers.set("sense-signature", header);
  const request = new Request("http://localhost/api/webhook/sense/company-1", {
    method: "POST",
    body,
    headers
  });
  return action({ request, params: { companyId: "company-1" } } as never);
}

beforeEach(() => {
  vi.mocked(trigger).mockReset();
  db.integration = { active: true, metadata: {}, secretRef: "secret-ref" };
  db.vault = { apiKey: "sense-key", webhookSigningSecret: SECRET };
  db.devices = [
    {
      id: "device-1",
      companyId: "company-1",
      integration: "sense",
      externalDeviceId: STATION
    }
  ];
});

describe("Sense webhook", () => {
  it("wakes the sync of the mapped station a signed delivery names", async () => {
    expect(await run(statusChanged())).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledExactlyOnceWith("oee-device-sync", {
      companyId: "company-1",
      integrationId: "sense",
      externalDeviceId: STATION
    });
  });

  it("acknowledges a station no work center maps, with no sync", async () => {
    expect(await run(statusChanged("other-station"))).toEqual({
      success: true
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does not wake a sync for a station mapped in another company", async () => {
    db.devices = [{ ...db.devices[0], companyId: "company-2" }];
    expect(await run(statusChanged())).toEqual({ success: true });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("acknowledges a test delivery and another event type, with no sync", async () => {
    const test = JSON.stringify({ ...JSON.parse(statusChanged()), test: true });
    const other = JSON.stringify({
      type: "site.updated",
      data: { site_id: "site-1" }
    });
    expect(await run(test)).toEqual({ success: true });
    expect(await run(other)).toEqual({ success: true });
    expect(trigger).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["from another secret", `t=1,v1=${"a".repeat(64)}`]
  ])("refuses a delivery with a signature %s", async (_name, signature) => {
    expect(await run(statusChanged(), signature)).toMatchObject({
      init: { status: 401 }
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("refuses a delivery while Carbon holds no signing secret", async () => {
    db.vault = { apiKey: "sense-key" };
    expect(await run(statusChanged())).toMatchObject({ init: { status: 401 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  // Sense disables a webhook answered with 410 until the next install.
  it.each([
    ["uninstalled", { active: false, metadata: {}, secretRef: "secret-ref" }],
    ["never installed", null]
  ])("answers 410 when Sense is %s", async (_name, integration) => {
    db.integration = integration;
    expect(await run(statusChanged())).toMatchObject({ init: { status: 410 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("refuses a signed delivery that is not a readable event", async () => {
    expect(await run("not json")).toMatchObject({ init: { status: 400 } });
    expect(trigger).not.toHaveBeenCalled();
  });

  // Sense retries a 500, so the change is not lost.
  it("answers 500 when the sync cannot be queued", async () => {
    vi.mocked(trigger).mockRejectedValue(new Error("Inngest is down"));
    expect(await run(statusChanged())).toMatchObject({ init: { status: 500 } });
  });
});
