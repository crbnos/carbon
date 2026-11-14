// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, describe, expect, it, vi } from "vitest";
import {
  generateDownloadToken,
  verifyDownloadToken
} from "./download-token.server";

// The module reads its secret once, at import.
vi.hoisted(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});

afterAll(() => vi.unstubAllEnvs());

const payload = {
  userId: "user-1",
  companyId: "company-1",
  documentId: "doc-1"
};

/** The token with its payload segment replaced, the signature kept. */
function withPayload(token: string, claims: Record<string, unknown>) {
  const [header, , signature] = token.split(".");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.${signature}`;
}

describe("download tokens", () => {
  it("verify to the user, company and document they were minted for", async () => {
    const token = await generateDownloadToken(payload);
    expect(await verifyDownloadToken(token)).toEqual(payload);
  });

  it("do not verify once the payload names another company", async () => {
    const token = await generateDownloadToken(payload);
    const forged = withPayload(token, { ...payload, companyId: "company-2" });
    await expect(verifyDownloadToken(forged)).rejects.toThrow();
  });
});
