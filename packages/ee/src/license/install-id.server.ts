// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHash } from "node:crypto";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";

const logger = getLogger("ee", "licence");

let installId: Promise<string> | null = null;

function asUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * A stable id for this install, sent on check-in. Derived from the oldest
 * company rather than stored, so a Redis flush does not change it. Rejects
 * when it cannot be derived: a stand-in id would show the issuer two
 * installs for one licence.
 */
export function getInstallId(): Promise<string> {
  installId ??= (async () => {
    const { data, error } = await getCarbonServiceRole()
      .from("company")
      .select("id")
      .order("createdAt")
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      logger.warn("licence: no company to derive the install id from", {
        error
      });
      installId = null; // try again on the next call
      throw new Error("licence: cannot derive the install id");
    }
    return asUuid(`crbn.instance:${data.id}`);
  })();
  return installId;
}
