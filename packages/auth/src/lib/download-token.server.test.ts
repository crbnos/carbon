// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  DownloadTokenExpiredError,
  generateDownloadToken,
  verifyDownloadToken
} from "./download-token.server";

// The module reads its secret once, at import.
vi.hoisted(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});

afterAll(() => vi.unstubAllEnvs());
afterEach(() => vi.useRealTimers());

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

  it("minted to expire verify until then and read as expired after", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-18T09:00:00Z") });
    const token = await generateDownloadToken(payload, {
      expiresInSeconds: 3600
    });

    vi.setSystemTime(Date.parse("2026-11-18T09:59:00Z"));
    expect(await verifyDownloadToken(token)).toEqual(payload);

    vi.setSystemTime(Date.parse("2026-11-18T10:01:00Z"));
    await expect(verifyDownloadToken(token)).rejects.toBeInstanceOf(
      DownloadTokenExpiredError
    );
  });

  it("minted without an expiry still verify years later", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-18T09:00:00Z") });
    const token = await generateDownloadToken(payload);
    vi.setSystemTime(Date.parse("2031-11-18T09:00:00Z"));
    expect(await verifyDownloadToken(token)).toEqual(payload);
  });
});
