// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import { isFirstOperationOfMakeMethod } from "~/services/operations.service";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

const log = getLogger("mes", "printing");

/**
 * Triggers an auto-print of the entity's label when the operation is the
 * first of its make method's routing (the unit was just minted) and the work
 * center's printer assignment has auto-print enabled.
 *
 * "First" comes from the routing (`isFirstOperationOfMakeMethod`), the same
 * answer the operation and assembly views use — never from the unit's
 * `Operation <id>` completion markers. A unit completed at a later operation
 * can carry one marker or none (the kanban scan completes the next incomplete
 * unit, which need not be one that passed the first operation; a batch lot
 * carries no markers at all), and counting them reprinted a label at every
 * later operation.
 *
 * Shared by every MES path that completes a tracked unit — the Complete
 * form (`x+/complete.tsx`) and the QR/kanban scan (`x+/end.$operationId.tsx`)
 * — so a label prints however the operator completes it.
 */
export async function autoPrintFirstOperationLabel({
  serviceRole,
  trackedEntityId,
  jobOperationId,
  jobMakeMethodId,
  workCenterId,
  companyId,
  userId
}: {
  serviceRole: ServiceRole;
  trackedEntityId: string;
  jobOperationId: string;
  jobMakeMethodId: string | null;
  workCenterId: string | undefined;
  companyId: string;
  userId: string;
}) {
  try {
    if (!workCenterId || !jobMakeMethodId) return;
    const [{ data: entity }, isFirstOperation] = await Promise.all([
      serviceRole
        .from("trackedEntity")
        .select("id")
        .eq("id", trackedEntityId)
        .eq("companyId", companyId)
        .maybeSingle(),
      isFirstOperationOfMakeMethod(serviceRole, jobOperationId, jobMakeMethodId)
    ]);
    // Service-role read: an entity outside the caller's company prints nothing.
    if (!entity || !isFirstOperation) return;

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
