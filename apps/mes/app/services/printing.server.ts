// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { shouldPrintOperationLabel } from "@carbon/database/travelers";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import {
  isFirstOperationOfMakeMethod,
  isLastOperationOfMakeMethod
} from "~/services/operations.service";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

const log = getLogger("mes", "printing");

/**
 * Triggers an auto-print of a unit's label at one of two print points, when
 * the work center's printer assignment has auto-print enabled:
 *
 * - The first operation of the make method's routing (the unit was just
 *   minted) prints the unit label — unless the company's `travelerLabels`
 *   switch is on, because the travelers printed at picking already carry it.
 * - The last operation of the top-level make method prints the finished-good
 *   label when the item's serial sequence has `printLabelOnCompletion` on.
 *
 * `shouldPrintOperationLabel` (`@carbon/database/travelers`) decides. "First"
 * and "last" come from the routing (`isFirstOperationOfMakeMethod`,
 * `isLastOperationOfMakeMethod`), the same answer the operation and assembly
 * views use — never from the unit's `Operation <id>` completion markers. A unit
 * completed at a later operation can carry one marker or none (the kanban scan
 * completes the next incomplete unit, which need not be one that passed the
 * first operation; a batch lot carries no markers at all), and counting them
 * reprinted a label at every later operation.
 *
 * Shared by every MES path that completes a tracked unit — the Complete
 * form (`x+/complete.tsx`), the QR/kanban scan (`x+/end.$operationId.tsx`)
 * and inspection lots (`services/quality.server.ts`) — so a label prints
 * however the operator completes it.
 */
export async function autoPrintOperationLabel({
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
    const [
      { data: entity },
      isFirstOperation,
      isLastOperation,
      { data: makeMethod },
      { data: settings }
    ] = await Promise.all([
      serviceRole
        .from("trackedEntity")
        .select("id")
        .eq("id", trackedEntityId)
        .eq("companyId", companyId)
        .maybeSingle(),
      isFirstOperationOfMakeMethod(
        serviceRole,
        jobOperationId,
        jobMakeMethodId
      ),
      isLastOperationOfMakeMethod(serviceRole, jobOperationId, jobMakeMethodId),
      serviceRole
        .from("jobMakeMethod")
        .select("parentMaterialId, itemId")
        .eq("id", jobMakeMethodId)
        .eq("companyId", companyId)
        .maybeSingle(),
      serviceRole
        .from("companySettings")
        .select("travelerLabels")
        .eq("id", companyId)
        .maybeSingle()
    ]);
    // Service-role read: an entity outside the caller's company prints nothing.
    if (!entity || !makeMethod) return;

    const { data: sequence } = await serviceRole
      .from("itemSerialSequence")
      .select("printLabelOnCompletion")
      .eq("itemId", makeMethod.itemId)
      .eq("companyId", companyId)
      .maybeSingle();

    const print = shouldPrintOperationLabel({
      isFirstOperation,
      isLastOperation,
      isTopLevelMakeMethod: makeMethod.parentMaterialId === null,
      travelerLabels: settings?.travelerLabels ?? false,
      printLabelOnCompletion: !!sequence?.printLabelOnCompletion
    });
    if (!print) return;

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

/**
 * Triggers an auto-print of a picking list's travelers (one per unit of every
 * job on the list) when the company's `travelerLabels` switch is on and the
 * location's inventory printer has auto-print enabled. The caller decides when
 * a list starts (`shouldPrintTravelers`, `@carbon/database/travelers`).
 *
 * Never throws: a print failure must not fail the status change.
 */
export async function autoPrintPickingListTravelers({
  serviceRole,
  pickingListId,
  locationId,
  companyId,
  userId
}: {
  serviceRole: ServiceRole;
  pickingListId: string;
  locationId: string;
  companyId: string;
  userId: string;
}): Promise<void> {
  try {
    const { data: settings } = await serviceRole
      .from("companySettings")
      .select("travelerLabels")
      .eq("id", companyId)
      .maybeSingle();
    if (settings?.travelerLabels !== true) return;

    const config = await getCachedPrinterConfig(
      serviceRole,
      companyId,
      locationId,
      "inventory"
    );
    if (config?.autoPrint ?? true) {
      await trigger("print-job", {
        sourceDocument: "PickingList",
        sourceDocumentId: pickingListId,
        companyId,
        userId,
        locationId
      });
    }
  } catch (error) {
    log.error("Traveler print failed", { companyId, pickingListId, error });
  }
}
