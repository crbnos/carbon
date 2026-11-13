// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  findTrackedEntityByCode,
  getTravelerTarget,
  isUnitInProduction
} from "~/services/traveler.server";
import { parseTravelerCode } from "~/utils/traveler";

// Resolves a raw tracked entity id or readable id (an old label) to the unit
// it names, so the layout's wedge can open its traveler.
export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const code = (new URL(request.url).searchParams.get("code") ?? "").trim();
  if (!code) return { status: "notFound" as const };

  const id = parseTravelerCode(code) ?? code;
  const serviceRole = getCarbonServiceRole();
  const result = await findTrackedEntityByCode(serviceRole, {
    code: id,
    companyId
  });
  if (
    result.kind === "notFound" ||
    result.kind === "ambiguous" ||
    result.kind === "error"
  ) {
    return { status: result.kind };
  }

  const target = await getTravelerTarget(serviceRole, {
    trackedEntityId: result.entity.id,
    companyId
  });

  // A failed check cannot tell a unit still being built from a finished one,
  // so the scan reports an error instead of issuing it.
  const inProduction = await isUnitInProduction(serviceRole, {
    companyId,
    trackedEntityId: target?.trackedEntityId,
    jobMakeMethodId: target?.jobMakeMethodId
  });
  if (inProduction.data === null) return { status: "error" as const };

  return {
    status: "found" as const,
    trackedEntityId: result.entity.id,
    scannedStatus: result.entity.status,
    scannedItemId: result.entity.itemId,
    target,
    targetInProduction: inProduction.data
  };
}
