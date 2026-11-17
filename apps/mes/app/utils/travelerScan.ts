// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TravelerScanResponse } from "~/routes/x+/traveler.scan";
import { path } from "~/utils/path";

export type TravelerScanRequest = {
  code: string;
  operationId?: string;
  trackedEntityId?: string;
  jobOperationStepId?: string;
  unitNumber?: number;
};

/**
 * Sends a scanned label to the server, which decides what it means. Resolves
 * to where the operator goes next (`href`), or a refusal (`href: null`).
 */
export async function postTravelerScan(
  body: TravelerScanRequest
): Promise<TravelerScanResponse & { status: number }> {
  try {
    const response = await fetch(path.to.travelerScan, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as TravelerScanResponse;
    return { ...result, status: response.status };
  } catch {
    return {
      href: null,
      operationId: null,
      trackedEntityId: null,
      message: "Could not look up this label. Try again.",
      status: 0
    };
  }
}
