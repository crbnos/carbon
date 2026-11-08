// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SenseWebhook } from "./provider";
import {
  readSenseEvent,
  reconcileSenseWebhook,
  verifySenseWebhook
} from "./webhook";

const secret = "whsec_test-secret";

// The shape of a real staging delivery (2026-10-28).
const body = JSON.stringify({
  id: "f173e259-4c99-4bd2-a3ef-a4d7765d278c",
  data: {
    id: "f173e259-4c99-4bd2-a3ef-a4d7765d278c",
    status: "Idle",
    site_id: "6b6ed3d4-b5d9-4d68-81de-88ac372df999",
    device_id: "758d41d3-2724-41a6-9465-cbc8f73c2642",
    created_at: "2026-10-28T22:36:42.675Z"
  },
  type: "station.status_changed"
});

const sign = (t: string, payload: string, key = secret) =>
  createHmac("sha256", key).update(`${t}.${payload}`).digest("hex");

describe("verifySenseWebhook", () => {
  it("accepts the HMAC of `t.body` keyed by the whole secret", () => {
    const signature = `t=1793226951,v1=${sign("1793226951", body)}`;
    expect(verifySenseWebhook({ signature, body, secret })).toBe(true);
  });

  it("accepts any of several v1 signatures", () => {
    const signature = `t=1793226951,v1=${sign("1793226951", body, "whsec_old")},v1=${sign("1793226951", body)}`;
    expect(verifySenseWebhook({ signature, body, secret })).toBe(true);
  });

  it("refuses a changed body, timestamp or secret", () => {
    const v1 = sign("1793226951", body);
    expect(
      verifySenseWebhook({
        signature: `t=1793226951,v1=${v1}`,
        body: body.replace("Idle", "Active"),
        secret
      })
    ).toBe(false);
    expect(
      verifySenseWebhook({ signature: `t=1793226952,v1=${v1}`, body, secret })
    ).toBe(false);
    expect(
      verifySenseWebhook({
        signature: `t=1793226951,v1=${v1}`,
        body,
        secret: "whsec_other"
      })
    ).toBe(false);
  });

  it("refuses a missing or malformed header", () => {
    const v1 = sign("1793226951", body);
    for (const signature of [
      null,
      "",
      `v1=${v1}`,
      "t=1793226951",
      `t=abc,v1=${v1}`,
      `t=1793226951,v1=${v1}zz`,
      // The body's HMAC alone, without the timestamp prefix.
      `t=1793226951,v1=${createHmac("sha256", secret).update(body).digest("hex")}`
    ]) {
      expect(verifySenseWebhook({ signature, body, secret })).toBe(false);
    }
    expect(
      verifySenseWebhook({
        signature: `t=1793226951,v1=${v1}`,
        body,
        secret: ""
      })
    ).toBe(false);
  });
});

describe("readSenseEvent", () => {
  const delivery = JSON.parse(body);

  it("reads the station of a status change", () => {
    expect(readSenseEvent(delivery)).toEqual({
      stationId: "758d41d3-2724-41a6-9465-cbc8f73c2642"
    });
  });

  it("ignores a test delivery, though it carries a real station", () => {
    expect(readSenseEvent({ ...delivery, test: true })).toEqual({
      stationId: null
    });
  });

  // A refusal counts towards Sense disabling the webhook.
  it("acknowledges another event type whatever its data holds", () => {
    for (const data of [{ site_id: "site-1" }, [], "text", undefined]) {
      expect(readSenseEvent({ type: "site.updated", data })).toEqual({
        stationId: null
      });
    }
  });

  it("refuses a status change with no station, and a malformed delivery", () => {
    expect(readSenseEvent({ type: delivery.type, data: {} })).toBeNull();
    expect(readSenseEvent({ type: delivery.type })).toBeNull();
    expect(readSenseEvent(null)).toBeNull();
    expect(readSenseEvent({ data: delivery.data })).toBeNull();
  });
});

describe("reconcileSenseWebhook", () => {
  const url = "https://erp.example.com/api/webhook/sense/company-1";
  const elsewhere = "https://other-system.example.com/hooks";

  const webhook = (overrides: Partial<SenseWebhook>): SenseWebhook => ({
    id: "wh-1",
    url,
    enabled: true,
    disabled_reason: null,
    ...overrides
  });

  /** Sense's one webhook and its secret, plus the secret Carbon holds. */
  function run({
    existing,
    carbonSecret = null,
    repairOnly = false
  }: {
    existing: SenseWebhook | null;
    carbonSecret?: string | null;
    repairOnly?: boolean;
  }) {
    const state = {
      webhook: existing,
      senseSecret: existing ? "whsec_original" : null,
      carbonSecret,
      writes: 0,
      carbonHeldSecretWhenEnabled: null as boolean | null
    };
    let rotations = 0;
    const result = reconcileSenseWebhook({
      url,
      repairOnly,
      hasSecret: carbonSecret !== null,
      storeSecret: async (secret) => {
        state.carbonSecret = secret;
      },
      sense: {
        getWebhook: async () => state.webhook,
        createWebhook: async (target) => {
          state.writes += 1;
          state.webhook = webhook({ url: target });
          state.senseSecret = "whsec_created";
          return { id: state.webhook.id, secret: state.senseSecret };
        },
        updateWebhook: async (_id, target) => {
          state.writes += 1;
          state.webhook = { ...(state.webhook as SenseWebhook), url: target };
          return state.webhook;
        },
        rotateWebhookSecret: async () => {
          state.writes += 1;
          rotations += 1;
          state.senseSecret = `whsec_rotated-${rotations}`;
          return { secret: state.senseSecret };
        },
        enableWebhook: async () => {
          state.writes += 1;
          state.carbonHeldSecretWhenEnabled =
            state.carbonSecret === state.senseSecret;
          state.webhook = webhook({ url: state.webhook?.url });
          return state.webhook;
        }
      }
    });
    return result.then((changed) => ({ changed, ...state }));
  }

  it("creates the webhook when Sense has none, on a save or in the sweep", async () => {
    for (const repairOnly of [false, true]) {
      const after = await run({ existing: null, repairOnly });
      expect(after.changed).toBe(true);
      expect(after.webhook?.url).toBe(url);
      expect(after.carbonSecret).toBe("whsec_created");
    }
  });

  it("a save takes over a webhook pointing elsewhere, with a secret of its own", async () => {
    const after = await run({
      existing: webhook({ url: elsewhere }),
      carbonSecret: "whsec_old"
    });
    expect(after.changed).toBe(true);
    expect(after.webhook?.url).toBe(url);
    expect(after.carbonSecret).toBe(after.senseSecret);
    expect(after.carbonSecret).not.toBe("whsec_old");
  });

  it("a save keeps the secret of a healthy webhook", async () => {
    const after = await run({
      existing: webhook({}),
      carbonSecret: "whsec_original"
    });
    expect(after.senseSecret).toBe("whsec_original");
    expect(after.carbonSecret).toBe("whsec_original");
  });

  // A delivery verified against a secret Carbon does not hold yet would count
  // as a failure, and enough of those disable the webhook again.
  it("holds the new secret before it enables a disabled webhook", async () => {
    const after = await run({
      existing: webhook({
        enabled: false,
        disabled_reason: "CONSECUTIVE_FAILURES"
      }),
      carbonSecret: "whsec_original"
    });
    expect(after.webhook?.enabled).toBe(true);
    expect(after.carbonHeldSecretWhenEnabled).toBe(true);
  });

  it("the sweep leaves a webhook pointing elsewhere untouched", async () => {
    for (const carbonSecret of [null, "whsec_old"]) {
      const after = await run({
        existing: webhook({ url: elsewhere }),
        carbonSecret,
        repairOnly: true
      });
      expect(after.changed).toBe(false);
      expect(after.writes).toBe(0);
      expect(after.webhook?.url).toBe(elsewhere);
      expect(after.senseSecret).toBe("whsec_original");
      expect(after.carbonSecret).toBe(carbonSecret);
    }
  });

  it("the sweep writes nothing to a healthy webhook", async () => {
    const after = await run({
      existing: webhook({}),
      carbonSecret: "whsec_original",
      repairOnly: true
    });
    expect(after.changed).toBe(false);
    expect(after.writes).toBe(0);
  });

  it("the sweep gets a secret for a webhook here that Carbon holds none for", async () => {
    const after = await run({ existing: webhook({}), repairOnly: true });
    expect(after.changed).toBe(true);
    expect(after.carbonSecret).toBe(after.senseSecret);
    expect(after.carbonSecret).not.toBeNull();
  });

  it("the sweep brings back a webhook Sense disabled", async () => {
    for (const disabled_reason of ["CONSECUTIVE_FAILURES", "GONE"]) {
      const after = await run({
        existing: webhook({ enabled: false, disabled_reason }),
        carbonSecret: "whsec_original",
        repairOnly: true
      });
      expect(after.changed).toBe(true);
      expect(after.webhook?.enabled).toBe(true);
      expect(after.carbonHeldSecretWhenEnabled).toBe(true);
    }
  });

  it("the sweep leaves a webhook disabled with no reason from Sense", async () => {
    const after = await run({
      existing: webhook({ enabled: false }),
      carbonSecret: "whsec_original",
      repairOnly: true
    });
    expect(after.changed).toBe(false);
    expect(after.writes).toBe(0);
    expect(after.webhook?.enabled).toBe(false);
  });
});
