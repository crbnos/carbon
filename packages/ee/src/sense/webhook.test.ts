// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SenseWebhookEventSchema, verifySenseWebhook } from "./webhook";

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

describe("SenseWebhookEventSchema", () => {
  it("reads the station of a status change and flags a test delivery", () => {
    const event = SenseWebhookEventSchema.parse(JSON.parse(body));
    expect(event.data?.device_id).toBe("758d41d3-2724-41a6-9465-cbc8f73c2642");
    expect(event.test).toBeUndefined();
    expect(
      SenseWebhookEventSchema.parse({ ...JSON.parse(body), test: true }).test
    ).toBe(true);
  });
});
