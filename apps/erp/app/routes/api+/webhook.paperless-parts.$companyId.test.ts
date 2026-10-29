// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "00112233445566778899aabbccddeeff";
const TIMESTAMP = 1_726_070_400;

// The installed integration row getIntegration reads; its secrets come from the vault stub.
const integrationRow = { metadata: {}, secretRef: "secret-ref" };
vi.mock("@carbon/auth/client.server", () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: integrationRow, error: null })
  };
  return { getCarbonServiceRole: () => ({ from: () => query }) };
});
vi.mock("@carbon/ee", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveIntegrationSecrets: () => ({ apiKey: "api-key", secretKey: SECRET })
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.paperless-parts.$companyId";

function signature(body: string) {
  return createHmac("sha256", Buffer.from(SECRET, "hex"))
    .update(`${TIMESTAMP}.${body}`)
    .digest("hex");
}

function run(
  body: string,
  options: { signedBody?: string; signature?: string } = {}
) {
  const request = new Request(
    "http://localhost/api/webhook/paperless-parts/company-1",
    {
      method: "POST",
      body,
      headers: {
        "Paperless-Parts-Signature": `t=${TIMESTAMP},v1=${
          options.signature ?? signature(options.signedBody ?? body)
        }`,
        "content-type": "application/json"
      }
    }
  );
  return action({ request, params: { companyId: "company-1" } } as never);
}

describe("Paperless Parts webhook signature verification", () => {
  beforeEach(() => {
    vi.mocked(trigger).mockReset();
  });

  it("verifies the exact signed body when Python escapes Unicode", async () => {
    const body =
      '{"type": "quote.sent", "data": {"quote_notes": "Caf\\u00e9"}}';

    expect(await run(body)).toEqual({ success: true });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("keeps accepting Paperless' historical normalized representation", async () => {
    const body = '{"type":"quote.sent","data":{"quote_notes":"ASCII"}}';
    const normalizedBody =
      '{"type": "quote.sent", "data": {"quote_notes": "ASCII"}}';

    expect(await run(body, { signedBody: normalizedBody })).toEqual({
      success: true
    });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("rejects an invalid signature without enqueueing the webhook", async () => {
    const result = (await run('{"type":"quote.sent","data":{}}', {
      signature: "0".repeat(64)
    })) as { init?: { status?: number } };

    expect(result.init?.status).toBe(401);
    expect(trigger).not.toHaveBeenCalled();
  });
});
