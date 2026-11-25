// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { userContext } from "~/context";
import {
  findTrackedEntityByCode,
  scanTraveler
} from "~/services/traveler.server";
import { path, TRAVELER_PARAM } from "~/utils/path";
import {
  parseTravelerCode,
  travelerIssueSerial,
  travelerScreenParams
} from "~/utils/traveler";

const scanValidator = z.object({
  issueId: z.string().min(1).max(100).optional(),
  expectedSerial: z.string().optional(),
  /** A traveler link, or a raw id or readable id from an older label. */
  code: z.string().refine((value) => value.trim().length > 0),
  /** The operation page the scan was made on, and the unit on screen. */
  operationId: z.string().optional(),
  trackedEntityId: z.string().optional(),
  jobOperationStepId: z.string().optional(),
  unitNumber: z.number().int().positive().optional()
});

export type TravelerScanResponse = {
  /** Where the operator goes next; null when the scan was refused. */
  href: string | null;
  /** The operation and unit `href` opens, when it opens one. */
  operationId: string | null;
  trackedEntityId: string | null;
  message: string | null;
  /** Refused because no unit is held where one must be: ask for the unit. */
  pickUnit?: boolean;
};

/**
 * A scanned label. The server decides what it means: open the work the unit
 * travels with, claim a free unit into the next unit that needs it, or send
 * the operator to the traveler page to choose. Safe to retry.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await authorize(request, {});
  const { locationId, effectiveUserId } = context.get(userContext) ?? {};

  const parsed = scanValidator.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return reply(400, null, "Invalid scan");
  }
  const { code, operationId, issueId, expectedSerial, ...screen } = parsed.data;

  const client = getCarbonServiceRole();
  const found = await findTrackedEntityByCode(client, {
    code: parseTravelerCode(code) ?? code,
    companyId
  });
  if (found.kind === "error") {
    return reply(503, null, "Could not look up this label. Try again.");
  }
  if (found.kind === "ambiguous") {
    return reply(409, null, "This barcode matches more than one unit");
  }
  if (found.kind === "notFound") {
    return reply(
      404,
      null,
      "This label does not belong to a unit in this company"
    );
  }

  const scan = await scanTraveler(client, {
    companyId,
    userId,
    locationId: locationId ?? null,
    employeeId: effectiveUserId ?? userId,
    trackedEntityId: found.entity.id,
    issueId,
    expectedSerial: travelerIssueSerial(code, found.entity, expectedSerial),
    confirmedChoice: expectedSerial !== undefined,
    at: operationId ? { operationId, ...screen } : undefined
  });
  if (scan.resolution === null) {
    return reply(409, null, scan.error, scan.pickUnit);
  }

  const { resolution, claimed } = scan;
  // A claim's unit may be the server's pick, so it is never marked scanned.
  if (claimed && resolution.kind === "claim") {
    return openOperation(
      claimed.operationId,
      claimed.parentTrackedEntityId,
      `${resolution.unit.readableId} → ${claimed.parentReadableId}`,
      false
    );
  }
  switch (resolution.kind) {
    case "open":
      return openOperation(
        resolution.operationId,
        resolution.trackedEntityId,
        null,
        true
      );
    case "refuse":
      return reply(409, null, resolution.message, resolution.pickUnit);
    case "notFound":
      return reply(
        404,
        null,
        "This label does not belong to a unit in this company"
      );
    case "claim": {
      const params = travelerScreenParams({ operationId, ...screen });
      return reply(
        200,
        path.to.traveler(resolution.unit.id) +
          (params.size ? `?${params}` : ""),
        null
      );
    }
    default:
      // Choices and unit details live on the traveler page.
      return reply(200, path.to.traveler(found.entity.id), null);
  }
}

function reply(
  status: number,
  href: string | null,
  message: string | null,
  pickUnit?: boolean
) {
  return data<TravelerScanResponse>(
    { href, operationId: null, trackedEntityId: null, message, pickUnit },
    { status }
  );
}

/** `scanned`: the operator scanned this unit's own label. */
function openOperation(
  operationId: string,
  trackedEntityId: string,
  message: string | null,
  scanned: boolean
) {
  const href = `${path.to.operation(operationId)}?trackedEntityId=${trackedEntityId}`;
  return data<TravelerScanResponse>({
    href: scanned ? `${href}&${TRAVELER_PARAM}` : href,
    operationId,
    trackedEntityId,
    message
  });
}
