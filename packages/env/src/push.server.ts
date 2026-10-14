// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/// <reference types="node" />
import { createECDH, hkdfSync } from "node:crypto";
import { SUPPORT_EMAIL } from "@carbon/utils";
import { getAppUrl, SESSION_SECRET } from "./index";

export type VapidDetails = {
  /** base64url, the 65-byte uncompressed P-256 point the browser subscribes with */
  publicKey: string;
  /** base64url, the 32-byte P-256 scalar */
  privateKey: string;
  /** Contact for push services: a mailto: or https: URL */
  subject: string;
};

// The order of P-256, big-endian. A private key is a scalar in [1, n − 1].
const P256_ORDER = Buffer.from(
  "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
  "hex"
);

/**
 * The deployment's Web Push (VAPID) key pair, derived from the secret so
 * there is nothing to generate or configure. The same secret always gives the
 * same pair, and it must: every browser subscription is bound to the public
 * key it was made with.
 */
export function deriveVapidDetails(
  secret: string,
  appUrl: string
): VapidDetails {
  // Push services take an https: URL or a mailto:. A plain-http app URL is
  // only ever a local stack.
  const subject = appUrl.startsWith("https://")
    ? appUrl
    : `mailto:${SUPPORT_EMAIL}`;

  for (let attempt = 0; ; attempt++) {
    // Never change the hash, the salt "carbon" or the info label: they ARE the
    // key. Any change gives every deployment a new pair, and every browser
    // subscription stops working. push.server.test.ts pins a known answer.
    const scalar = Buffer.from(
      hkdfSync("sha256", secret, "carbon", `web-push-vapid/${attempt}`, 32)
    );
    // Out of range for about 1 secret in 2^32; the next attempt is just as
    // deterministic.
    // Both are 32 bytes big-endian, so byte order is numeric order.
    const isZero = scalar.every((byte) => byte === 0);
    if (isZero || Buffer.compare(scalar, P256_ORDER) >= 0) continue;

    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(scalar);
    return {
      privateKey: scalar.toString("base64url"),
      publicKey: ecdh.getPublicKey().toString("base64url"),
      subject
    };
  }
}

let cached: VapidDetails | null | undefined;

/**
 * Null only where SESSION_SECRET is unset (a script run with
 * SKIP_ENV_VALIDATION); everywhere else push is on. Rotating SESSION_SECRET
 * rotates the pair: each browser re-subscribes with the new key on its next
 * visit; until then send-push logs each push the old-key row refuses.
 */
export function getVapidDetails(): VapidDetails | null {
  if (cached === undefined) {
    cached = SESSION_SECRET
      ? deriveVapidDetails(SESSION_SECRET, getAppUrl())
      : null;
  }
  return cached;
}

export function isPushConfigured(): boolean {
  return getVapidDetails() !== null;
}
