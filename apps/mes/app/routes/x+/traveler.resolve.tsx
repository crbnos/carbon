// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  findTrackedEntityByCode,
  getTravelerTarget
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
  if (result.kind === "notFound" || result.kind === "ambiguous") {
    return { status: result.kind };
  }

  const target = await getTravelerTarget(serviceRole, {
    trackedEntityId: result.entity.id,
    companyId
  });

  return {
    status: "found" as const,
    trackedEntityId: result.entity.id,
    scannedStatus: result.entity.status,
    scannedItemId: result.entity.itemId,
    target
  };
}
