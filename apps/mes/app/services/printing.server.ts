// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

const log = getLogger("mes", "printing");

/**
 * Triggers an auto-print of the entity's label when this is its first
 * operation (i.e. the entity was just minted) and the work center's
 * printer assignment has auto-print enabled.
 *
 * Shared by every MES path that completes a tracked unit — the Complete
 * form (`x+/complete.tsx`) and the QR/kanban scan (`x+/end.$operationId.tsx`)
 * — so a label prints however the operator completes it.
 */
export async function autoPrintFirstOperationLabel({
  serviceRole,
  trackedEntityId,
  workCenterId,
  companyId,
  userId
}: {
  serviceRole: ServiceRole;
  trackedEntityId: string;
  workCenterId: string | undefined;
  companyId: string;
  userId: string;
}) {
  try {
    const { data: entity } = await serviceRole
      .from("trackedEntity")
      .select("attributes")
      .eq("id", trackedEntityId)
      .eq("companyId", companyId)
      .maybeSingle();
    // Service-role read: an entity outside the caller's company prints nothing.
    if (!entity) return;

    const attributes = (entity?.attributes ?? {}) as Record<string, unknown>;
    const operationCount = Object.keys(attributes).filter((k) =>
      k.startsWith("Operation ")
    ).length;
    if (operationCount > 1) return;

    if (!workCenterId) return;
    const { data: workCenter } = await serviceRole
      .from("workCenter")
      .select("locationId")
      .eq("id", workCenterId)
      .eq("companyId", companyId)
      .maybeSingle();
    const locationId = workCenter?.locationId ?? undefined;
    if (!locationId) return;

    const config = await getCachedPrinterConfig(
      serviceRole,
      companyId,
      locationId,
      "workCenter",
      workCenterId
    );
    if (config?.autoPrint ?? true) {
      await trigger("print-job", {
        sourceDocument: "Job",
        sourceDocumentId: trackedEntityId,
        companyId,
        userId,
        locationId,
        workCenterId
      });
    }
  } catch (e) {
    log.error("Auto-print failed", { companyId, trackedEntityId, error: e });
  }
}
