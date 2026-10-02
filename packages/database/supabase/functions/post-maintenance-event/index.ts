// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^4.5.4";
import { RecordNotFoundError } from "../lib/company-records.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { credit, debit, journalReference } from "../lib/utils.ts";
import { resolveAccountingPeriod } from "../shared/get-accounting-period.ts";
import { createAdjustmentJournal } from "../shared/post-adjustment.ts";
import {
  diffLaborGroups,
  type LaborDimension,
  type LaborGroup,
  maintenanceLaborCost,
} from "./plan.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// Reconciles maintenance dispatches' labor postings with their time entries —
// call it after an entry is ended, added, edited or deleted, or a dispatch is
// completed. Time is expensed at the work center's labor rate (no overhead):
// Dr maintenanceAccount / Cr laborAbsorptionAccount, one journal per dispatch
// that changed. Idempotent: see ./plan.ts.
const payloadValidator = z.object({
  maintenanceDispatchIds: z.array(z.string()).min(1),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const { maintenanceDispatchIds, userId, companyId } =
      payloadValidator.parse(await req.json());
    const dispatchIds = [...new Set(maintenanceDispatchIds)];

    // Kysely below bypasses RLS, so the caller must hold this permission in the company it names.
    const client = await requirePermissions(req, companyId, userId, {
      update: "resources",
    });

    const settings = await client
      .from("companySettings")
      .select("accountingEnabled")
      .eq("id", companyId)
      .single();
    if (!settings.data?.accountingEnabled) {
      return jsonResponse({ success: true, journalIds: [] });
    }

    const postingDate = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();

    const journalIds = await db.transaction().execute(async (trx) => {
      // Row locks: two reconciles of one dispatch must not both post the same
      // difference.
      const dispatches = await trx
        .selectFrom("maintenanceDispatch")
        .select(["id", "maintenanceDispatchId"])
        .where("id", "in", dispatchIds)
        .where("companyId", "=", companyId)
        .forUpdate()
        .execute();
      if (dispatches.length !== dispatchIds.length) {
        throw new RecordNotFoundError("Maintenance dispatch not found");
      }

      const [events, priorLines, accountDefaults, dimensions] =
        await Promise.all([
          trx
            .selectFrom("maintenanceDispatchEvent")
            .select([
              "id",
              "maintenanceDispatchId",
              "endTime",
              "duration",
              "workCenterId",
              "employeeId",
            ])
            .where("maintenanceDispatchId", "in", dispatchIds)
            .where("companyId", "=", companyId)
            .execute(),
          trx
            .selectFrom("journalLine")
            .select([
              "id",
              "documentId",
              "documentLineReference",
              "accountId",
              "amount",
            ])
            .where("documentType", "=", "Maintenance Event")
            .where("documentId", "in", dispatchIds)
            .where("companyId", "=", companyId)
            .execute(),
          trx
            .selectFrom("accountDefault")
            .select(["maintenanceAccount", "laborAbsorptionAccount"])
            .where("companyId", "=", companyId)
            .executeTakeFirst(),
          trx
            .selectFrom("dimension")
            .innerJoin(
              "company",
              "company.companyGroupId",
              "dimension.companyGroupId"
            )
            .select(["dimension.id", "dimension.entityType"])
            .where("company.id", "=", companyId)
            .where("dimension.active", "=", true)
            .where("dimension.entityType", "in", [
              "Employee",
              "WorkCenter",
              "Location",
            ])
            .execute(),
        ]);
      if (!accountDefaults) throw new Error("Error getting account defaults");

      const ended = events.filter((e) => e.endTime && Number(e.duration) > 0);
      const workCenterIds = [...new Set(ended.map((e) => e.workCenterId))];
      const [workCenters, priorDimensions] = await Promise.all([
        workCenterIds.length
          ? trx
              .selectFrom("workCenter")
              .select(["id", "laborRate", "locationId"])
              .where("id", "in", workCenterIds)
              .where("companyId", "=", companyId)
              .execute()
          : Promise.resolve([]),
        priorLines.length
          ? trx
              .selectFrom("journalLineDimension")
              .select(["journalLineId", "dimensionId", "valueId"])
              .where(
                "journalLineId",
                "in",
                priorLines.map((l) => l.id)
              )
              .where("companyId", "=", companyId)
              .execute()
          : Promise.resolve([]),
      ]);
      const workCenterById = new Map(workCenters.map((wc) => [wc.id, wc]));

      const dimensionIdByType = new Map(
        dimensions
          .filter((d) => d.entityType)
          .map((d) => [d.entityType as string, d.id])
      );
      const tag = (entityType: string, valueId: string | null | undefined) =>
        valueId && dimensionIdByType.has(entityType)
          ? [{ dimensionId: dimensionIdByType.get(entityType)!, valueId }]
          : [];

      // What each dispatch's entries should have posted.
      const desiredByDispatch = new Map<string, LaborGroup[]>();
      for (const event of ended) {
        const workCenter = workCenterById.get(event.workCenterId);
        const cost = maintenanceLaborCost(event.duration, workCenter?.laborRate);
        if (cost <= 0) continue;
        if (!accountDefaults.laborAbsorptionAccount) {
          throw new Error(
            "laborAbsorptionAccount not configured in account defaults"
          );
        }
        const reference = journalReference.to.maintenanceEvent(event.id);
        const eventDimensions: LaborDimension[] = [
          ...tag("Employee", event.employeeId),
          ...tag("WorkCenter", event.workCenterId),
          ...tag("Location", workCenter?.locationId),
        ];
        const list = desiredByDispatch.get(event.maintenanceDispatchId) ?? [];
        list.push(
          {
            reference,
            accountId: accountDefaults.maintenanceAccount,
            dimensions: eventDimensions,
            amount: debit("expense", cost),
          },
          {
            reference,
            accountId: accountDefaults.laborAbsorptionAccount,
            dimensions: eventDimensions,
            amount: credit("expense", cost),
          }
        );
        desiredByDispatch.set(event.maintenanceDispatchId, list);
      }

      // What the journal already holds, with each line's own tags.
      const dimensionsByLine = new Map<string, LaborDimension[]>();
      for (const d of priorDimensions) {
        const list = dimensionsByLine.get(d.journalLineId) ?? [];
        list.push({ dimensionId: d.dimensionId, valueId: d.valueId });
        dimensionsByLine.set(d.journalLineId, list);
      }
      const priorByDispatch = new Map<string, LaborGroup[]>();
      for (const line of priorLines) {
        const dispatchId = line.documentId ?? "";
        const list = priorByDispatch.get(dispatchId) ?? [];
        list.push({
          reference: line.documentLineReference ?? "",
          accountId: line.accountId ?? "",
          dimensions: dimensionsByLine.get(line.id) ?? [],
          amount: Number(line.amount),
        });
        priorByDispatch.set(dispatchId, list);
      }

      let accountingPeriodId: string | null = null;
      const posted: string[] = [];

      for (const dispatch of dispatches) {
        const prior = priorByDispatch.get(dispatch.id) ?? [];
        const delta = diffLaborGroups(
          desiredByDispatch.get(dispatch.id) ?? [],
          prior
        );
        if (delta.length === 0) continue;

        accountingPeriodId ??= (
          await resolveAccountingPeriod(trx, companyId, postingDate, "current")
        ).id;
        const journalId = await createAdjustmentJournal(trx, {
          companyId,
          accountingPeriodId,
          description: `Maintenance Labor ${dispatch.maintenanceDispatchId}${
            prior.length > 0 ? " (Adjustment)" : ""
          }`,
          postingDate,
          userId,
          sourceType: "Maintenance Event",
        });

        // One line per insert: each carries its own tags, and a multi-row
        // RETURNING does not promise insert order.
        const journalLineReference = nanoid();
        for (const group of delta) {
          const line = await trx
            .insertInto("journalLine")
            .values({
              journalId,
              accountId: group.accountId,
              description:
                group.accountId === accountDefaults.maintenanceAccount
                  ? "Maintenance Labor"
                  : "Labor Absorption",
              amount: group.amount,
              quantity: 1,
              documentType: "Maintenance Event",
              documentId: dispatch.id,
              documentLineReference: group.reference,
              journalLineReference,
              companyId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (group.dimensions.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(
                group.dimensions.map((d) => ({
                  journalLineId: line.id,
                  dimensionId: d.dimensionId,
                  valueId: d.valueId,
                  companyId,
                }))
              )
              .execute();
          }
        }
        posted.push(journalId);
      }

      return posted;
    });

    return jsonResponse({ success: true, journalIds });
  } catch (err) {
    console.error("Error in post-maintenance-event:", err);
    return errorResponse(err, 500);
  }
});
