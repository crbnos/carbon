// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  claimTravelerPrint,
  shouldPrintOperationLabel
} from "@carbon/database/travelers";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import { datetime } from "@carbon/utils";
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
    // Most completions are neither first nor last: they read the routing only.
    const [isFirstOperation, isLastOperation] = await Promise.all([
      isFirstOperationOfMakeMethod(
        serviceRole,
        jobOperationId,
        jobMakeMethodId
      ),
      isLastOperationOfMakeMethod(serviceRole, jobOperationId, jobMakeMethodId)
    ]);
    if (!isFirstOperation && !isLastOperation) return;

    const [{ data: entity }, { data: makeMethod }, { data: settings }] =
      await Promise.all([
        serviceRole
          .from("trackedEntity")
          .select("id")
          .eq("id", trackedEntityId)
          .eq("companyId", companyId)
          .maybeSingle(),
        serviceRole
          .from("jobMakeMethod")
          .select("parentMaterialId, itemId")
          .eq("id", jobMakeMethodId)
          .eq("companyId", companyId)
          .maybeSingle(),
        // `travelerLabels` decides only the first-operation print.
        isFirstOperation
          ? serviceRole
              .from("companySettings")
              .select("travelerLabels")
              .eq("id", companyId)
              .maybeSingle()
          : { data: null }
      ]);
    // Service-role read: an entity outside the caller's company prints nothing.
    if (!entity || !makeMethod) return;

    const isTopLevelMakeMethod = makeMethod.parentMaterialId === null;
    // The finished-good label prints only at the last top-level operation.
    const { data: sequence } =
      isLastOperation && isTopLevelMakeMethod
        ? await serviceRole
            .from("itemSerialSequence")
            .select("printLabelOnCompletion")
            .eq("itemId", makeMethod.itemId)
            .eq("companyId", companyId)
            .maybeSingle()
        : { data: null };

    const print = shouldPrintOperationLabel({
      isFirstOperation,
      isLastOperation,
      isTopLevelMakeMethod,
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
 * Prints a picking list's travelers (one per unit of every job on the list)
 * once, after a status change or a pick. With `companySettings.travelerLabels`
 * on, `claimTravelerPrint` (`@carbon/database/travelers`) sets the list's
 * `travelersPrintedAt`; only the call that sets it prints, at the location's
 * inventory printer when its auto-print is on. With the setting off nothing is
 * claimed, so turning it on later still prints a list not yet claimed.
 *
 * Never throws: a print failure must not fail the pick or the status change.
 */
export async function printTravelersOnStart({
  serviceRole,
  pickingListId,
  companyId,
  userId
}: {
  serviceRole: ServiceRole;
  pickingListId: string;
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

    const claim = await claimTravelerPrint(serviceRole, {
      pickingListId,
      companyId,
      at: datetime.timestamp()
    });
    if (claim.error) {
      log.error("Traveler print claim failed", {
        companyId,
        pickingListId,
        error: claim.error
      });
      return;
    }
    if (!claim.claimed || !claim.locationId) return;
    const locationId = claim.locationId;

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
