// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The lot decision: Accept, Reject or Partial, with the unit flips, rejected
// moves and write-off it carries. Public through `./quality.ts`.
import type { Insertable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import { withTransaction } from "./client.ts";
import { EPSILON, round } from "./precision.ts";
import {
  assertReceiptNotVoided,
  engineErrResult,
  INSPECTION_CLOSED_STATUSES,
  type InspectionSource,
  isInspectionClosed,
  type Result
} from "./quality-core.ts";
import {
  drawHeldStripes,
  type HeldStripe,
  heldStockStripes,
  lockClaimUnit,
  lotClaimableAtUnit,
  withInspectionRelease
} from "./quality-hold.ts";

export type InspectionDispositionInput = {
  id: string;
  decision: "Accept" | "Reject" | "Partial";
  notes?: string;
  // Why a lot is rejected when no characteristic reached its rejection number
  // and no sample failed — a suspected counterfeit, the wrong part, transit
  // damage. A Reject with a reason needs no failure; it is stored as the lot's
  // notes when `notes` is empty.
  reason?: string;
  companyId: string;
  dispositionedBy: string;
  // One-shot mode: refuse to disposition a lot that is already terminal
  // (Passed/Failed/Partial). The MES disposition route passes this because its
  // dispositions drive physical postings (scrap/rework/complete) that must not
  // re-run.
  requireOpen?: boolean;
  // Restrict the disposition to lots of these sources. The ERP Accept/Reject/Partial
  // routes pass Receipt and Manual because their verdicts carry NO physical
  // production posting — accepting a Job Operation lot here would hard-terminate
  // it with no complete/scrap/rework and wedge the operation (whose outcome the
  // MES disposition route owns). The MES job-operation route omits this so it
  // can disposition Job Operation lots.
  requireSource?: InspectionSource | InspectionSource[];
  // Partial on an untracked (Inventory) receipt lot: how much passed. Required
  // there, ignored otherwise.
  acceptedQuantity?: number;
};

// -------------------------------------------------------------
// 2. dispositionInspection
// -------------------------------------------------------------
// Writes:
//   - trackedEntity.status
//   - inspection (status, dispositionedBy/At, notes)
//   - inspectionHistory (1 row for future plan auto-switching)

/**
 * Whether a lot has failed inspection, so it can be rejected with no reason
 * given. A document-driven lot fails when a characteristic reaches its
 * rejection number or a sample fails; a lot with no characteristics when its
 * failed samples pass the acceptance number. Anything else — a suspected
 * counterfeit, the wrong part — needs a reason. The ERP and MES Reject
 * buttons apply the same rule.
 */
export function isRejectableWithoutReason(lot: {
  features: { rejectionNumber: number; failed: number }[];
  failedSamples: number;
  acceptanceNumber: number;
}): boolean {
  if (lot.features.length > 0) {
    return (
      lot.features.some((f) => f.failed >= f.rejectionNumber) ||
      lot.failedSamples > 0
    );
  }
  return lot.failedSamples > lot.acceptanceNumber;
}

/**
 * What the rejected move takes out of the held unit: each listed serial or
 * batch unit with its on-hand there, or (untracked) up to `untrackedQuantity`
 * of the item's on-hand there. Never more than is there.
 */
async function rejectedMoves(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    fromStorageUnitId: string;
    trackedEntityIds: string[] | null;
    untrackedQuantity: number | null;
    documentIds: string[];
  }
): Promise<
  Array<{
    trackedEntityId: string | null;
    projectId: string | null;
    quantity: number;
  }>
> {
  if (args.trackedEntityIds === null) {
    if (!args.untrackedQuantity || args.untrackedQuantity <= EPSILON) return [];
    const stripes = await heldStockStripes(trx, {
      companyId: args.companyId,
      itemId: args.itemId,
      storageUnitId: args.fromStorageUnitId,
      documentIds: args.documentIds
    });
    return drawHeldStripes(args.untrackedQuantity, stripes).map((draw) => ({
      trackedEntityId: null,
      ...draw
    }));
  }
  if (args.trackedEntityIds.length === 0) return [];
  const rows = await trx
    .selectFrom("itemLedger")
    .select([
      "trackedEntityId",
      "projectId",
      sql<number>`SUM("quantity")`.as("quantity")
    ])
    .where("companyId", "=", args.companyId)
    .where("storageUnitId", "=", args.fromStorageUnitId)
    .where("trackedEntityId", "in", args.trackedEntityIds)
    .groupBy(["trackedEntityId", "projectId"])
    .execute();
  return rows
    .map((row) => ({
      trackedEntityId: row.trackedEntityId,
      projectId: row.projectId,
      quantity: round(Number(row.quantity))
    }))
    .filter((row) => row.quantity > EPSILON);
}

export async function dispositionInspection(
  db: Kysely<KyselyDatabase>,
  args: InspectionDispositionInput
): Promise<
  Result<{
    id: string;
    status: string;
    // Non-tracked Inventory reject: the inventory write-off the route must post
    // through post-nonconformance (itemLedger + cost relief + GL). Null when the
    // decision/tracking type needs no compensating ledger movement.
    writeOff: {
      itemId: string;
      quantity: number;
      locationId: string | null;
      storageUnitId: string | null;
      stripes: HeldStripe[];
    } | null;
    // The untracked quantity a Partial left rejected; the caller opens an NCR
    // for it. Null otherwise.
    rejectedQuantity: number | null;
  }>
> {
  const nowIso = new Date().toISOString();

  try {
    const result = await withTransaction(db, async (trx) => {
      const source = await trx
        .selectFrom("inspection")
        .select(["sourceDocument", "sourceDocumentId"])
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!source) throw new Error("Inspection not found");
      const allowedSources = args.requireSource
        ? ([] as InspectionSource[]).concat(args.requireSource)
        : null;
      if (
        allowedSources &&
        !allowedSources.includes(source.sourceDocument as InspectionSource)
      ) {
        throw new Error(
          `This disposition is only available for ${allowedSources.join(" and ")} inspections`
        );
      }
      await assertReceiptNotVoided(trx, args.companyId, source, "noKeyUpdate");

      const inspection = await trx
        .selectFrom("inspection")
        .select([
          "id",
          "storageUnitId",
          "sourceDocument",
          "sourceDocumentId",
          "sourceDocumentLineId",
          "itemId",
          "status",
          "supplierId",
          "samplingStandard",
          "severity",
          "inspectionLevel",
          "aql",
          "lotSize",
          "sampleSize",
          "acceptanceNumber"
        ])
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      // Only a receipt lot is dispositioned again (the write-off retry); a
      // manual lot's verdict is final.
      if (
        (args.requireOpen || inspection.sourceDocument === "Manual") &&
        isInspectionClosed(inspection.status)
      ) {
        throw new Error("Inspection is already dispositioned");
      }
      const isReceiptSource = inspection.sourceDocument === "Receipt";
      const isRejectRetry =
        inspection.status === "Failed" && args.decision === "Reject";
      if (
        isReceiptSource &&
        isInspectionClosed(inspection.status) &&
        !isRejectRetry
      ) {
        throw new Error(
          inspection.status === "Partial"
            ? "This lot is already partly accepted. Its NCR decides the rest."
            : inspection.status === "Cancelled"
              ? "This lot was cancelled with its receipt."
              : "This lot is already decided."
        );
      }

      const item = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", inspection.itemId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();

      // Receipt-sourced lots: the received tracked entities and the receiving
      // location hang off the receipt line. Manual lots list their entities in
      // inspectionTrackedEntity. Job Operation lots have none to flip: they act
      // on WIP, not stock.
      const receiptLine =
        isReceiptSource && inspection.sourceDocumentLineId
          ? await trx
              .selectFrom("receiptLine")
              .select(["locationId", "storageUnitId"])
              .where("id", "=", inspection.sourceDocumentLineId)
              .where("companyId", "=", args.companyId)
              .executeTakeFirst()
          : undefined;

      const lotEntities =
        isReceiptSource && inspection.sourceDocumentLineId
          ? await trx
              .selectFrom("trackedEntity")
              .select(["id"])
              .where(
                sql<string>`attributes ->> 'Receipt Line'`,
                "=",
                inspection.sourceDocumentLineId
              )
              .where("companyId", "=", args.companyId)
              .execute()
          : inspection.sourceDocument === "Manual"
            ? await trx
                .selectFrom("inspectionTrackedEntity")
                .select(["trackedEntityId as id"])
                .where("inspectionId", "=", args.id)
                .where("companyId", "=", args.companyId)
                .execute()
            : [];

      const existingSamples = await trx
        .selectFrom("inspectionSample")
        .select(["trackedEntityId", "status"])
        .where("inspectionId", "=", args.id)
        .execute();

      const failedEntityIds = new Set(
        existingSamples
          .filter((s) => s.status === "Failed")
          .map((s) => s.trackedEntityId)
          .filter(Boolean)
      );
      const allLotIds = lotEntities.map((e) => e.id);
      const failures = existingSamples.filter(
        (s) => s.status === "Failed"
      ).length;

      // Per-feature gating (document-driven lots). Each feature must meet its
      // own resolved sample size and acceptance number before Accept; Reject
      // requires a feature past its rejection number or a failed sample. Lots
      // without features keep the caller-side lot-level gating untouched.
      const lotFeatures = await trx
        .selectFrom("inspectionSamplingPlan")
        .select([
          "inspectionFeatureId",
          "sampleSize",
          "acceptanceNumber",
          "rejectionNumber"
        ])
        .where("inspectionId", "=", args.id)
        .execute();

      const countsByFeature = new Map<
        string,
        { recorded: number; failed: number }
      >();
      if (lotFeatures.length > 0) {
        const measurements = await trx
          .selectFrom("inspectionMeasurement")
          .select(["inspectionFeatureId", "status"])
          .where("inspectionId", "=", args.id)
          .execute();
        for (const m of measurements) {
          const counts = countsByFeature.get(m.inspectionFeatureId) ?? {
            recorded: 0,
            failed: 0
          };
          if (m.status !== "Pending") counts.recorded += 1;
          if (m.status === "Failed") counts.failed += 1;
          countsByFeature.set(m.inspectionFeatureId, counts);
        }

        if (args.decision === "Accept") {
          const blocking = lotFeatures.filter((f) => {
            const counts = countsByFeature.get(f.inspectionFeatureId) ?? {
              recorded: 0,
              failed: 0
            };
            return (
              counts.recorded < f.sampleSize ||
              counts.failed > f.acceptanceNumber
            );
          });
          if (blocking.length > 0) {
            throw new Error(
              "Cannot accept: sampling incomplete or acceptance number exceeded for one or more features"
            );
          }
        }
      }

      if (
        args.decision === "Reject" &&
        !args.reason?.trim() &&
        !isRejectableWithoutReason({
          features: lotFeatures.map((f) => ({
            rejectionNumber: f.rejectionNumber,
            failed: countsByFeature.get(f.inspectionFeatureId)?.failed ?? 0
          })),
          failedSamples: failures,
          acceptanceNumber: inspection.acceptanceNumber
        })
      ) {
        throw new Error(
          "Cannot reject: the lot has not failed inspection. Give a reason to reject it anyway."
        );
      }

      if (
        args.decision === "Partial" &&
        isReceiptSource &&
        item?.itemTrackingType === "Batch"
      ) {
        throw new Error("A batch lot is accepted or rejected as a whole.");
      }
      if (
        args.decision === "Partial" &&
        isReceiptSource &&
        item?.itemTrackingType === "Non-Inventory"
      ) {
        throw new Error(
          "A non-inventory lot is accepted or rejected as a whole."
        );
      }
      if (args.decision === "Partial" && isReceiptSource) {
        const links = await trx
          .selectFrom("nonConformanceInspection as link")
          .innerJoin("nonConformance as ncr", "ncr.id", "link.nonConformanceId")
          .leftJoin("nonConformanceInspection as sibling", (join) =>
            join
              .onRef("sibling.nonConformanceId", "=", "link.nonConformanceId")
              .onRef("sibling.inspectionId", "!=", "link.inspectionId")
          )
          .select(["ncr.status", "sibling.inspectionId as siblingId"])
          .where("link.inspectionId", "=", args.id)
          .where("link.companyId", "=", args.companyId)
          .execute();
        if (links.some((link) => link.siblingId)) {
          throw new Error(
            "This lot shares its NCR with other lots. A Partial lot must be the only lot on its NCR."
          );
        }
        if (
          item?.itemTrackingType === "Inventory" &&
          links.some((link) => link.status === "Closed")
        ) {
          throw new Error(
            "This lot's NCR is already closed, so nothing would decide its rejected part. Remove the link or reject the lot."
          );
        }
      }
      const isTrackedReceiptLot = isReceiptSource && allLotIds.length > 0;
      if (
        args.decision === "Partial" &&
        isTrackedReceiptLot &&
        item?.itemTrackingType !== "Inventory"
      ) {
        const failedUnits = allLotIds.filter((id) => failedEntityIds.has(id));
        const passedSamples = existingSamples.filter(
          (s) => s.status === "Passed"
        ).length;
        const inspectedSamples = existingSamples.filter(
          (s) => s.status !== "Pending"
        ).length;
        const samplingComplete =
          lotFeatures.length > 0
            ? lotFeatures.every(
                (f) =>
                  (countsByFeature.get(f.inspectionFeatureId)?.recorded ?? 0) >=
                  f.sampleSize
              )
            : inspectedSamples >= inspection.sampleSize;
        if (failedUnits.length === 0) {
          throw new Error(
            "Cannot mark the lot partial: no unit of it failed its sample. Accept the lot, or reject it."
          );
        }
        if (passedSamples === 0) {
          throw new Error(
            "Cannot mark the lot partial: no sample passed. Reject the lot."
          );
        }
        if (!samplingComplete) {
          throw new Error(
            "Cannot mark the lot partial: sampling is incomplete for one or more features"
          );
        }
      }

      // Reject = entire lot non-conforming (ISO 9001:2015 §8.7). Accept
      // releases every lot entity that didn't fail a sample — un-sampled and
      // partially-inspected (Pending) units included — and rejects the failed
      // ones. Partial on a receipt lot does the same.
      let lotStatus: "Passed" | "Failed" | "Partial";
      const flips: { ids: string[]; status: "Available" | "Rejected" }[] = [];
      switch (args.decision) {
        case "Accept":
        case "Partial":
          lotStatus = args.decision === "Accept" ? "Passed" : "Partial";
          flips.push(
            {
              ids: allLotIds.filter((id) => !failedEntityIds.has(id)),
              status: "Available"
            },
            {
              ids: allLotIds.filter((id) => failedEntityIds.has(id)),
              status: "Rejected"
            }
          );
          break;
        case "Reject":
          lotStatus = "Failed";
          flips.push({ ids: allLotIds, status: "Rejected" });
          break;
      }

      const wasOpen = !isInspectionClosed(inspection.status);

      const isUntracked = item?.itemTrackingType === "Inventory";
      const heldStorageUnitId =
        inspection.storageUnitId ?? receiptLine?.storageUnitId ?? null;
      const lotDocumentIds = [inspection.id, inspection.sourceDocumentId ?? ""];

      // The unaccepted rest stays held (inspection_held_quantity) until the
      // lot's NCR closes.
      let acceptedQuantity: number | null = null;
      let rejectedQuantity: number | null = null;
      if (args.decision === "Partial" && isReceiptSource && isUntracked) {
        const accepted = round(Number(args.acceptedQuantity));
        if (
          args.acceptedQuantity === undefined ||
          !Number.isFinite(accepted) ||
          accepted < 0 ||
          round(inspection.lotSize - accepted) <= EPSILON
        ) {
          throw new Error(
            "Enter the accepted quantity: more than 0 and less than the lot size"
          );
        }
        if (accepted <= EPSILON) {
          throw new Error(
            "That is the whole lot rejected. Use Reject Lot instead."
          );
        }
        acceptedQuantity = accepted;
        rejectedQuantity = round(inspection.lotSize - accepted);
      } else if (
        isReceiptSource &&
        allLotIds.length > 0 &&
        (args.decision === "Partial" ||
          (args.decision === "Accept" &&
            allLotIds.some((id) => failedEntityIds.has(id))))
      ) {
        // A tracked lot's passed part is its Available units; the receipt's
        // inspection status reads it to tell when putaway is done.
        const passedIds = allLotIds.filter((id) => !failedEntityIds.has(id));
        const passed =
          passedIds.length > 0
            ? await trx
                .selectFrom("trackedEntity")
                .select(
                  sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity")
                )
                .where("id", "in", passedIds)
                .where("companyId", "=", args.companyId)
                .executeTakeFirst()
            : undefined;
        acceptedQuantity = round(Number(passed?.quantity ?? 0));
      }

      const untrackedTake =
        isReceiptSource && isUntracked && heldStorageUnitId
          ? args.decision === "Partial"
            ? rejectedQuantity
            : args.decision === "Reject" && inspection.lotSize > 0
              ? inspection.lotSize
              : null
          : null;
      let heldStripes: HeldStripe[] = [];
      const rejectedMove =
        isReceiptSource &&
        wasOpen &&
        heldStorageUnitId &&
        receiptLine?.locationId &&
        (args.decision === "Reject" || args.decision === "Partial")
          ? await trx
              .selectFrom("location")
              .select(["rejectedStorageUnitId"])
              .where("id", "=", receiptLine.locationId)
              .where("companyId", "=", args.companyId)
              .executeTakeFirst()
              .then((location) =>
                location?.rejectedStorageUnitId &&
                location.rejectedStorageUnitId !== heldStorageUnitId
                  ? {
                      to: location.rejectedStorageUnitId,
                      from: heldStorageUnitId,
                      locationId: receiptLine.locationId as string
                    }
                  : null
              )
          : null;
      const movesRejected = rejectedMove !== null;
      const legacyHoldsInPlace =
        args.decision === "Partial" &&
        isUntracked &&
        !inspection.storageUnitId &&
        !!heldStorageUnitId &&
        !movesRejected &&
        (await trx
          .selectFrom("storageUnit")
          .select("effectiveNettable")
          .where("id", "=", heldStorageUnitId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
          .then((unit) => !!unit && !unit.effectiveNettable));
      let writeOffQuantity = inspection.lotSize;
      if (untrackedTake !== null && heldStorageUnitId) {
        const writtenOff =
          !wasOpen &&
          (await trx
            .selectFrom("itemLedger")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("documentType", "=", "Inbound Inspection")
            .where("documentId", "=", inspection.id)
            .limit(1)
            .executeTakeFirst());
        const holdsStock =
          inspection.storageUnitId !== null || args.decision === "Partial";
        const claimable = () =>
          lotClaimableAtUnit(trx, {
            companyId: args.companyId,
            itemId: inspection.itemId,
            storageUnitId: heldStorageUnitId,
            locationId: receiptLine?.locationId,
            ownHeld:
              wasOpen && inspection.storageUnitId !== null
                ? inspection.lotSize
                : 0
          });
        if (
          args.decision === "Partial" &&
          !writtenOff &&
          (inspection.storageUnitId !== null ||
            legacyHoldsInPlace ||
            movesRejected)
        ) {
          const claim = await claimable();
          if (untrackedTake - claim > EPSILON) {
            throw new Error(
              `Only ${claim} of the ${untrackedTake} rejected are in the held storage unit, so the rest cannot stay held. Correct the stock there, or reject the lot: a Reject writes off what is there.`
            );
          }
        }
        if (args.decision === "Reject" && holdsStock && !writtenOff) {
          writeOffQuantity = wasOpen
            ? round(Math.min(inspection.lotSize, await claimable()))
            : 0;
        }
        if (args.decision === "Reject") {
          if (!holdsStock || writtenOff) {
            await lockClaimUnit(trx, {
              companyId: args.companyId,
              itemId: inspection.itemId,
              storageUnitId: heldStorageUnitId,
              locationId: receiptLine?.locationId
            });
          }
          heldStripes = await heldStockStripes(trx, {
            companyId: args.companyId,
            itemId: inspection.itemId,
            storageUnitId: heldStorageUnitId,
            documentIds: lotDocumentIds
          });
        }
      }

      // Serial and batch units move by id from the held unit. Untracked stock has
      // no id, so only the decision that closes an open lot moves it: once closed,
      // the held unit's stock may belong to another lot.
      let movedToStorageUnitId: string | null = null;
      let moveRows: Insertable<KyselyDatabase["itemLedger"]>[] = [];
      if (rejectedMove) {
        const moves = await rejectedMoves(trx, {
          companyId: args.companyId,
          itemId: inspection.itemId,
          fromStorageUnitId: rejectedMove.from,
          trackedEntityIds: isUntracked
            ? null
            : args.decision === "Reject"
              ? allLotIds
              : [...failedEntityIds].filter((id): id is string => !!id),
          untrackedQuantity:
            isUntracked && args.decision === "Partial"
              ? rejectedQuantity
              : null,
          documentIds: lotDocumentIds
        });
        if (moves.length > 0) {
          if (isUntracked) movedToStorageUnitId = rejectedMove.to;
          const [{ today }] = (
            await sql<{
              today: string;
            }>`SELECT company_today(${args.companyId})::text AS today`.execute(
              trx
            )
          ).rows as [{ today: string }];
          moveRows = moves.flatMap((move) => {
            const row = {
              postingDate: today,
              itemId: inspection.itemId,
              locationId: rejectedMove.locationId,
              trackedEntityId: move.trackedEntityId,
              projectId: move.projectId,
              entryType: "Transfer" as const,
              documentType: "Direct Transfer" as const,
              documentId: inspection.id,
              comment: "Rejected at inspection",
              companyId: args.companyId,
              createdBy: args.dispositionedBy
            };
            return [
              {
                ...row,
                storageUnitId: rejectedMove.from,
                quantity: -move.quantity
              },
              {
                ...row,
                storageUnitId: rejectedMove.to,
                quantity: move.quantity
              }
            ];
          });
        }
      }

      // Non-tracked (Inventory) items have no tracked entities to flip, so the
      // received quantity sits in itemLedger with no per-row status to exclude
      // it from on-hand. Rejecting the lot posts a compensating write-off —
      // itemLedger Negative Adjmt. + cost relief + GL — through the
      // post-nonconformance posting, which the ERP reject runs in this same
      // transaction. Tracked items are
      // handled by the status flip above; Non-Inventory never posted a
      // receipt ledger entry, so neither needs a write-off.
      const writeOff =
        args.decision === "Reject" &&
        isReceiptSource &&
        item?.itemTrackingType === "Inventory" &&
        writeOffQuantity > EPSILON
          ? {
              itemId: inspection.itemId,
              quantity: -writeOffQuantity,
              locationId: receiptLine?.locationId ?? null,
              storageUnitId: heldStorageUnitId,
              stripes: drawHeldStripes(writeOffQuantity, heldStripes, {
                overflow: true
              }).map((draw) => ({
                projectId: draw.projectId,
                quantity: -draw.quantity
              }))
            }
          : null;

      const legacyHoldUnitId =
        acceptedQuantity !== null && !movedToStorageUnitId && legacyHoldsInPlace
          ? heldStorageUnitId
          : null;

      const updated = await withInspectionRelease(trx, () =>
        trx
          .updateTable("inspection")
          .set({
            status: lotStatus,
            ...(wasOpen
              ? {
                  notes: args.notes || args.reason?.trim() || null,
                  dispositionedBy: args.dispositionedBy,
                  dispositionedAt: nowIso
                }
              : {}),
            ...(acceptedQuantity !== null ? { acceptedQuantity } : {}),
            ...((movedToStorageUnitId ?? legacyHoldUnitId)
              ? { storageUnitId: movedToStorageUnitId ?? legacyHoldUnitId }
              : {}),
            updatedBy: args.dispositionedBy,
            updatedAt: nowIso
          })
          .where("id", "=", args.id)
          .where("companyId", "=", args.companyId)
          .$if(args.requireOpen === true, (qb) =>
            qb.where("status", "not in", [...INSPECTION_CLOSED_STATUSES])
          )
          .returning(["id", "status"])
          .executeTakeFirst()
      );
      if (!updated) {
        throw new Error("Inspection is already dispositioned");
      }

      if (wasOpen) {
        for (const flip of flips) {
          if (flip.ids.length === 0) continue;
          await trx
            .updateTable("trackedEntity")
            .set({ status: flip.status })
            .where("id", "in", flip.ids)
            .where("companyId", "=", args.companyId)
            .execute();
        }
      }
      if (moveRows.length > 0) {
        await trx.insertInto("itemLedger").values(moveRows).execute();
      }

      if (wasOpen) {
        await trx
          .insertInto("inspectionHistory")
          .values({
            inspectionId: args.id,
            itemId: inspection.itemId,
            supplierId: inspection.supplierId ?? null,
            samplingStandard: inspection.samplingStandard,
            severity: inspection.severity ?? "Normal",
            inspectionLevel: inspection.inspectionLevel ?? null,
            aql: inspection.aql ?? null,
            lotSize: inspection.lotSize,
            sampleSize: inspection.sampleSize,
            defectsFound: failures,
            outcome:
              args.decision === "Accept"
                ? "Accepted"
                : args.decision === "Reject"
                  ? "Rejected"
                  : "Partial",
            companyId: args.companyId,
            createdBy: args.dispositionedBy
          })
          .execute();
      }

      return {
        id: updated.id,
        status: updated.status,
        writeOff,
        rejectedQuantity
      };
    });

    return { data: result, error: null };
  } catch (err) {
    return engineErrResult(err, "Failed to disposition inspection");
  }
}
