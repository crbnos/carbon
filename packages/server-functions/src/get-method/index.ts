// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone, type Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { toJson, toJsonColumns } from "@carbon/database/json";
import {
  calculateQuoteLinePrices,
  getJobMethodTree,
  getQuoteMethodTree,
  getRatesFromSupplierProcesses,
  getRatesFromWorkCenters,
  type JobMethodTreeItem,
  type QuoteMethodTreeItem,
  traverseJobMethod,
  traverseJobMethodAsync,
  traverseQuoteMethod
} from "@carbon/database/methods";
import { effectiveReplenishment } from "@carbon/database/mrp-engine";
import {
  inOrder,
  isNull,
  many,
  maybeSingle,
  selectRow,
  selectRows,
  single
} from "@carbon/database/rows";
import {
  getNextRevisionSequence,
  getNextSequence
} from "@carbon/database/sequence";
import {
  buildConsumeFirstHops,
  buildConsumeFirstRules,
  buildSupersessionRedirectMap,
  consumeFirstStockItems,
  pullBackQuantities,
  reserveConsumeFirstStock,
  resolveMadeLinePull,
  type SupersessionContext,
  type SupersessionRow,
  settleConsumeFirstLine,
  withoutStockedConsumeFirst
} from "@carbon/database/supersession-pick";
import { getLogger } from "@carbon/logger";
import { datetime, scrapAllowance, textToTiptap } from "@carbon/utils";
import { type QueryCreator, sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { chunked } from "../import-csv/chunks";
import { getStorageUnitId } from "../lib/storage-units";
import { importTypeScript } from "./sandbox";

const logger = getLogger("server-functions", "get-method");

/**
 * An operation-step `description` as a tiptap doc for a jsonb column. The
 * Supabase client returns a jsonb scalar string as a JS string, and re-inserting
 * a JS string makes node-pg send unquoted text that Postgres rejects: objects
 * pass through, strings are wrapped, and null/empty become {}.
 */
function toTiptapDoc(value: unknown): Json {
  if (value && typeof value === "object") return value as Json;
  if (typeof value === "string" && value.length > 0) {
    return textToTiptap(value) as Json;
  }
  return {};
}

// quoteLine's jsonb columns — run through toJsonColumns() in quoteToQuote's per-line copy.
const QUOTE_LINE_JSON_COLUMNS = [
  "additionalCharges",
  "configuration",
  "customFields",
  "externalNotes",
  "internalNotes",
  "priceTrace"
] as const satisfies readonly (keyof Database["public"]["Tables"]["quoteLine"]["Row"])[];

// Stored configurator rules are user-authored JS that may still return legacy "Inside"/"Outside" operationType values.
const normalizeOperationType = (value: unknown) =>
  (value === "Inside"
    ? "Process"
    : value === "Outside"
      ? "Outside Processing"
      : value) as Database["public"]["Enums"]["operationType"];

// Copy an operation step's reference slides (grandchild) when a method/job/quote is
// copied. Source slides are queried by their (old) step ids and remapped onto the freshly
// inserted step ids — a bulk insert preserves order, so insertedStepIds[i] ↔ sourceSteps[i].
// Guarded: a no-op when there are no slides, so it can never break step copying.
// See .ai/specs/2026-07-14-mes-execution-views.md §4.
async function copyStepSlides(
  trx: Transaction<KyselyDatabase>,
  sourceSteps: Array<{ id?: string | null }>,
  insertedStepIds: Array<{ id: string }>,
  sourceTable:
    | "methodOperationStepSlide"
    | "jobOperationStepSlide"
    | "quoteOperationStepSlide",
  targetTable:
    | "methodOperationStepSlide"
    | "jobOperationStepSlide"
    | "quoteOperationStepSlide",
  companyId: string,
  userId: string
) {
  const sourceStepIds = sourceSteps
    .map((s) => s.id)
    .filter((id): id is string => !!id);
  if (sourceStepIds.length === 0) return;

  // The three slide tables share these columns; one name stands for all.
  const srcSlides = await selectRows(
    trx,
    sourceTable as "methodOperationStepSlide",
    { stepId: sourceStepIds }
  );

  const inserts = srcSlides.flatMap((sl) => {
    const idx = sourceSteps.findIndex((s) => s.id === sl.stepId);
    const newStepId = insertedStepIds[idx]?.id;
    if (!newStepId) return [];
    return [
      {
        stepId: newStepId,
        imagePath: sl.imagePath,
        modelUploadId: sl.modelUploadId,
        caption: sl.caption,
        sortOrder: sl.sortOrder,
        size: sl.size,
        annotations: sl.annotations,
        companyId,
        createdBy: userId
      }
    ];
  });

  if (inserts.length > 0) {
    await trx
      .insertInto(targetTable as any)
      .values(inserts as any)
      .execute();
  }
}

// Many-to-many step links (Phase 2): remap a parent's OLD operation-step ids onto the freshly
// inserted step ids via stepMap, dropping any that don't map. Empty in = the parent applies to
// the whole operation (no join rows, shown on every step in the MES).
function remapStepIds(
  oldIds: Array<string | null | undefined> | null | undefined,
  stepMap: Record<string, string>
): string[] {
  return (oldIds ?? []).flatMap((id) =>
    id && stepMap[id] ? [stepMap[id]] : []
  );
}

// Material twin of remapStepIds: get_method_tree aggregates methodMaterialStep as
// {id, quantity} objects (quantity NULL = the step uses the full BOM line quantity).
// Bare-string elements are tolerated for trees read before the aggregate changed.
function remapStepLinks(
  oldLinks:
    | Array<string | { id?: string | null; quantity?: number | null } | null>
    | null
    | undefined,
  stepMap: Record<string, string>
): { stepId: string; quantity: number | null }[] {
  return (oldLinks ?? []).flatMap((link) => {
    const id = typeof link === "string" ? link : link?.id;
    const quantity =
      typeof link === "object" && link !== null
        ? (link.quantity ?? null)
        : null;
    return id && stepMap[id]
      ? [
          {
            stepId: stepMap[id],
            quantity: quantity === null ? null : Number(quantity)
          }
        ]
      : [];
  });
}

// A BOM line whose quantity is explicitly 0 contributes nothing, so it is
// dropped whenever a method is instantiated or copied. `null`/`undefined` is
// NOT treated as zero — those fall back to a quantity of 1 elsewhere in this
// file, so only a real numeric 0 removes the line.
function isZeroQuantity(quantity: unknown): boolean {
  // Only a real numeric 0 removes the line. `getConfiguredValue` returns a
  // dynamically-configured value behind a type assertion, so `""`/`false`/`[]`
  // can reach here — `Number("")`/`Number(false)` are 0 and would wrongly drop
  // the line. A strict typeof check keeps those falling back to a quantity of 1.
  return typeof quantity === "number" && quantity === 0;
}

const partsValidator = z
  .object({
    billOfMaterial: z.boolean().default(true),
    billOfProcess: z.boolean().default(true),
    parameters: z.boolean().default(true),
    tools: z.boolean().default(true),
    steps: z.boolean().default(true),
    workInstructions: z.boolean().default(true)
    // prefault, not default: v4's .default() returns {} AS-IS on undefined input,
    // which would skip every inner default and disable all six part flags.
  })
  .prefault({});

export const getMethodInput = z.object({
  type: z.enum([
    "itemToItem",
    "itemToJob",
    "itemToJobMakeMethod",
    "itemToQuoteLine",
    "itemToQuoteMakeMethod",
    "jobMakeMethodToItem",
    "jobToItem",
    "jobToJob",
    "makeMethodToMakeMethod",
    "procedureToOperation",
    "quoteLineToItem",
    "quoteLineToJob",
    "quoteLineToQuoteLine",
    "quoteMakeMethodToItem",
    "quoteToQuote"
  ]),
  sourceId: z.string(),
  targetId: z.string(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  parts: partsValidator,
  // A specific source makeMethod version (itemToJob / itemToJobMakeMethod
  // only). Absent = the item's active method, as before.
  versionId: z.string().optional()
});

/** `newQuoteId` is set by quoteToQuote. */
export type GetMethodResult = { success: boolean; newQuoteId?: string };

/** Copies a method (BOM + BOP) between items, quotes and jobs, per `type`. */
const getMethod = defineServerFn({
  name: "get-method",
  input: getMethodInput,
  permissions: { update: "production" },
  async run(
    ctx,
    { type, sourceId, targetId, configuration, parts, versionId }
  ): Promise<GetMethodResult> {
    const { db, companyId, userId } = ctx;

    logger.info("get-method", {
      type,
      sourceId,
      targetId,
      companyId,
      userId,
      parts,
      configuration,
      versionId
    });

    switch (type) {
      case "itemToItem": {
        const [sourceMakeMethod, targetMakeMethod, targetItemReplenishment] =
          await inOrder([
            () =>
              single(db, "activeMakeMethods", { itemId: sourceId, companyId }),
            () =>
              single(db, "activeMakeMethods", { itemId: targetId, companyId }),
            () =>
              single(db, "itemReplenishment", { itemId: targetId, companyId })
          ]);
        if (sourceMakeMethod.error || targetMakeMethod.error) {
          throw new Error("Failed to get make methods");
        }

        if (targetItemReplenishment.error) {
          throw new Error("Failed to get target item replenishment");
        }

        if (targetItemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

        if (
          sourceMakeMethod.data.id === null ||
          targetMakeMethod.data.id === null
        ) {
          throw new Error("Failed to get make methods");
        }

        const [sourceMaterials, sourceOperations] = await inOrder([
          () =>
            parts.billOfMaterial
              ? many(db, "methodMaterial", {
                  makeMethodId: sourceMakeMethod.data.id,
                  companyId
                })
              : Promise.resolve({ data: [], error: null }),
          () =>
            parts.billOfProcess
              ? many<
                  "methodOperation",
                  Tables["methodOperation"]["Row"] & {
                    methodOperationTool: Tables["methodOperationTool"]["Row"][];
                    methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
                    methodOperationStep: Tables["methodOperationStep"]["Row"][];
                  }
                >(
                  db,
                  "methodOperation",
                  { makeMethodId: sourceMakeMethod.data.id, companyId },
                  {
                    embed: {
                      methodOperationTool: {
                        table: "methodOperationTool",
                        on: "operationId"
                      },
                      methodOperationParameter: {
                        table: "methodOperationParameter",
                        on: "operationId"
                      },
                      methodOperationStep: {
                        table: "methodOperationStep",
                        on: "operationId"
                      }
                    }
                  }
                )
              : Promise.resolve({ data: [], error: null })
        ]);

        if (sourceMaterials.error || sourceOperations.error) {
          throw new Error("Failed to get source materials or operations");
        }

        await db.transaction().execute(async (trx) => {
          // Delete existing materials and operations from target method
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "=", targetMakeMethod.data.id)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("methodOperation")
                  .where("makeMethodId", "=", targetMakeMethod.data.id)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);

          // Copy materials from source to target, dropping any zero-quantity
          // BOM lines.
          const materialsToCopy = (
            (sourceMaterials.data ??
              []) as Database["public"]["Tables"]["methodMaterial"]["Row"][]
          ).filter((material) => !isZeroQuantity(material.quantity));
          if (parts.billOfMaterial && materialsToCopy.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialsToCopy.map((material) => ({
                  ...material,
                  productionQuantity: undefined,
                  id: undefined, // Let the database generate a new ID
                  makeMethodId: targetMakeMethod.data.id!,
                  createdBy: userId
                }))
              )
              .execute();
          }

          // Copy operations from source to target
          if (
            parts.billOfProcess &&
            sourceOperations.data &&
            sourceOperations.data.length > 0
          ) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                sourceOperations.data.map(
                  ({
                    methodOperationTool: _tools,
                    methodOperationParameter: _parameters,
                    methodOperationStep: _attributes,
                    ...operation
                  }) => {
                    const insert = {
                      ...operation,
                      id: undefined, // Let the database generate a new ID
                      makeMethodId: targetMakeMethod.data.id!,
                      createdBy: userId
                    };
                    if (!parts.workInstructions) {
                      insert.workInstruction = {};
                    }
                    return insert;
                  }
                )
              )
              .returning(["id"])
              .execute();

            for await (const [
              index,
              operation
            ] of sourceOperations.data.entries()) {
              const {
                methodOperationTool,
                methodOperationParameter,
                methodOperationStep,
                procedureId
              } = operation;
              const operationId = operationIds[index]!.id;

              if (
                parts.tools &&
                operationId &&
                Array.isArray(methodOperationTool) &&
                methodOperationTool.length > 0
              ) {
                await trx
                  .insertInto("methodOperationTool")
                  .values(
                    methodOperationTool.map((tool) => ({
                      toolId: tool.toolId,
                      quantity: tool.quantity,
                      operationId,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .execute();
              }

              if (!procedureId) {
                if (
                  parts.parameters &&
                  Array.isArray(methodOperationParameter) &&
                  methodOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationParameter")
                    .values(
                      methodOperationParameter.map((param) => ({
                        operationId: operationId!,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (
                  parts.steps &&
                  // Assembly ops inherit steps from the linked instruction —
                  // never copy (possibly stale) template steps alongside it.
                  !operation.assemblyInstructionId &&
                  Array.isArray(methodOperationStep) &&
                  methodOperationStep.length > 0
                ) {
                  const insertedSteps = await trx
                    .insertInto("methodOperationStep")
                    .values(
                      methodOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
                        description: toTiptapDoc(attribute.description),
                        operationId: operationId!,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .returning(["id"])
                    .execute();

                  await copyStepSlides(
                    trx,
                    methodOperationStep,
                    insertedSteps,
                    "methodOperationStepSlide",
                    "methodOperationStepSlide",
                    companyId,
                    userId
                  );
                }
              }
            }
          }
        });

        break;
      }
      case "itemToJob": {
        const jobId = targetId;
        if (!jobId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;
        // Assembly ops whose steps were materialized from an instruction —
        // their material ↔ step links are flushed after the traversal has
        // inserted every node's jobMaterial rows.
        const assemblyOperationsToLink: Array<{
          operationId: string;
          assemblyInstructionId: string;
        }> = [];

        // These lookups go over the direct connection, one after another on
        // purpose: each is a few milliseconds, and running them at once would
        // take five of the process's sixteen pooled connections per call.
        //
        // A chosen version overrides the default active-method lookup; it is
        // re-read under itemId + companyId so a foreign or mismatched
        // makeMethod id can never be exploded.
        const makeMethod = versionId
          ? await db
              .selectFrom("makeMethod")
              .select(["id", "version"])
              .where("id", "=", versionId)
              .where("itemId", "=", itemId)
              .where("companyId", "=", companyId)
              .executeTakeFirst()
          : await db
              .selectFrom("activeMakeMethods")
              .select(["id", "version"])
              .where("itemId", "=", itemId)
              .where("companyId", "=", companyId)
              .executeTakeFirst();
        if (!makeMethod?.id) {
          throw new Error("Failed to get make method");
        }
        const makeMethodId = makeMethod.id;

        const jobMakeMethods = await db
          .selectFrom("jobMakeMethod")
          .select(["id"])
          .where("jobId", "=", jobId)
          .where("parentMaterialId", "is", null)
          .where("companyId", "=", companyId)
          .execute();
        // Exactly one root make method, as `.single()` required before.
        const jobMakeMethod = jobMakeMethods[0];
        if (!jobMakeMethod || jobMakeMethods.length > 1) {
          throw new Error("Failed to get job make method");
        }

        const workCenters = await db
          .selectFrom("workCenters")
          .selectAll()
          .where("companyId", "=", companyId)
          .execute();
        const supplierProcesses = await db
          .selectFrom("supplierProcess")
          .selectAll()
          .where("companyId", "=", companyId)
          .execute();
        const jobRow = await db
          .selectFrom("job")
          .select(["locationId", "quantity", "startDate", "dueDate"])
          .where("id", "=", jobId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!jobRow) {
          throw new Error("Failed to get job");
        }
        const job = jobRow;

        // Way 1 — supersession swap at job creation. Build "old item -> effective
        // successor (x conversion factor)" for this company, gated by the job's
        // build date, using the SAME shared logic as MRP so the job's materials
        // match what planning already redirected. Applied to Buy/Pick lines in the
        // mapper below.
        const supersessionContext = await loadSupersessionRedirect(
          db,
          companyId,
          job
        );
        const supersessionRedirect = supersessionContext.redirect;

        const hydratedConfiguration = await hydrateConfiguration(
          db,
          configuration,
          itemId,
          companyId
        );

        const methodTrees = await getMethodTree(db, makeMethodId);
        const configurationRules = isConfigured
          ? await selectRows(db, "configurationRule", { itemId, companyId })
          : [];

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new NotFoundError("Method tree not found");

        // The traversal below runs on a single transaction connection, so any
        // per-node or per-material query is O(tree) sequential roundtrips — on
        // a large BOM that exceeds the caller's request timeout. Prefetch each
        // lookup table once per tree instead.
        //
        // Trees arrive INCREMENTALLY, which is why this is a lazy layer rather
        // than one up-front walk: the main method tree here, plus one per
        // made-component supersession swap — swapMadeSubAssembly loads the
        // SUCCESSOR's tree and re-enters traverseMethod on it, and that tree's
        // nodes appear in no walk of this one. Every lookup therefore goes
        // through ensurePrefetched, which is idempotent and extends the maps
        // for ids it has not read yet. Without it an unwalked tree resolves to
        // `?? 0` / `?? []`: a whole sub-assembly with no operations and a
        // permanently wrong 0 scrap percentage (jobMaterial.itemScrapPercentage
        // is NOT NULL, and recalculate only re-derives from itemReplenishment
        // when the stored value is NULL, so nothing downstream can repair it).
        const scrapPercentageByItemId = new Map<string, number>();
        const defaultStorageUnitByItemId = new Map<string, string>();
        const jobLocationId = job.locationId;

        const operationsByMakeMethodId = new Map<
          string,
          MethodOperationRow[]
        >();

        // "Already read for this id" — deliberately distinct from a map miss,
        // which legitimately means "read, no row" (an item with no
        // itemReplenishment, a make method with no operations). Without these
        // sets a sparse item would be re-queried on every visit, which is the
        // N+1 this prefetch exists to remove.
        const prefetchedItemIds = new Set<string>();
        const prefetchedMakeMethodIds = new Set<string>();
        // Identity-based: getMethodTree structuredClones every node per call,
        // so two trees never share node objects. Also stops corrupt/cyclic
        // tree data from looping the walk.
        const seenTreeNodes = new Set<MethodTreeItem>();

        // `reader` is `db` before the transaction opens and `trx` inside it.
        // On a one-connection pool a `db` query issued while the transaction is
        // open would block until the request timeout. itemReplenishment / itemLedger / pickMethod need no embeds,
        // so they go over the direct Postgres connection — bind parameters, no
        // PostgREST URL-length cap (see .ai/lessons.md).
        async function ensureItemsPrefetched(
          reader: typeof db,
          itemIds: string[]
        ) {
          const missing = [...new Set(itemIds)].filter(
            (id) => id && !prefetchedItemIds.has(id)
          );
          if (missing.length === 0) return;

          const replenishmentRows = await reader
            .selectFrom("itemReplenishment")
            .select(["itemId", "scrapPercentage"])
            .where("itemId", "in", missing)
            .where("companyId", "=", companyId)
            .execute();
          for (const row of replenishmentRows) {
            scrapPercentageByItemId.set(
              row.itemId,
              Number(row.scrapPercentage ?? 0)
            );
          }

          // Default storage units at the job's location — two set-based
          // queries instead of up to two per material (getStorageUnitId):
          // pickMethod default wins, else the bin with the highest on-hand
          // quantity.
          if (jobLocationId) {
            const ledgerTotals = await reader
              .selectFrom("itemLedger")
              .where("locationId", "=", jobLocationId)
              .where("companyId", "=", companyId)
              .where("itemId", "in", missing)
              .where("storageUnitId", "is not", null)
              .groupBy(["itemId", "storageUnitId"])
              .select([
                "itemId",
                "storageUnitId",
                (eb) => eb.fn.sum("quantity").as("totalQuantity")
              ])
              .having((eb) => eb.fn.sum("quantity"), ">", 0)
              .execute();

            const bestQuantityByItemId = new Map<string, number>();
            for (const row of ledgerTotals) {
              const quantity = Number(row.totalQuantity);
              if (
                row.storageUnitId &&
                quantity > (bestQuantityByItemId.get(row.itemId) ?? 0)
              ) {
                bestQuantityByItemId.set(row.itemId, quantity);
                defaultStorageUnitByItemId.set(row.itemId, row.storageUnitId);
              }
            }

            const pickMethods = await reader
              .selectFrom("pickMethod")
              .select(["itemId", "defaultStorageUnitId"])
              .where("locationId", "=", jobLocationId)
              .where("companyId", "=", companyId)
              .where("itemId", "in", missing)
              .where("defaultStorageUnitId", "is not", null)
              .execute();

            for (const pickMethod of pickMethods) {
              if (pickMethod.defaultStorageUnitId) {
                defaultStorageUnitByItemId.set(
                  pickMethod.itemId,
                  pickMethod.defaultStorageUnitId
                );
              }
            }
          }

          // Marked covered only AFTER the rows land, so an id can never read as
          // "already fetched, no row" while its read is still in flight.
          for (const id of missing) prefetchedItemIds.add(id);
        }

        // One read over the direct connection: no URL length to chunk for and
        // no row cap to page around.
        async function ensureMakeMethodsPrefetched(
          reader: typeof db,
          makeMethodIds: string[]
        ) {
          const missing = [...new Set(makeMethodIds)].filter(
            (id) => id && !prefetchedMakeMethodIds.has(id)
          );
          if (missing.length === 0) return;

          for (const op of await readMethodOperations(
            reader,
            missing,
            companyId
          )) {
            const list = operationsByMakeMethodId.get(op.makeMethodId);
            if (list) {
              list.push(op);
            } else {
              operationsByMakeMethodId.set(op.makeMethodId, [op]);
            }
          }
          for (const id of missing) prefetchedMakeMethodIds.add(id);
        }

        // Walk the nodes of `root` that no pass has walked yet and read their
        // lookups in one batch. An already-covered tree returns at its root.
        async function ensurePrefetched(
          reader: typeof db,
          root: MethodTreeItem
        ) {
          const nodes: MethodTreeItem[] = [];
          const collect = (n: MethodTreeItem) => {
            if (seenTreeNodes.has(n)) return;
            seenTreeNodes.add(n);
            nodes.push(n);
            n.children.forEach(collect);
          };
          collect(root);
          if (nodes.length === 0) return;

          // A Buy/Pick line is swapped to its successor below, so the successor's
          // scrap percentage and default bin are needed even though no tree node
          // names it. Derived from THIS tree's nodes, not from the whole company's
          // redirect map: that map is every itemSupersession row in the tenant, and
          // feeding all of its targets here made the three reads scale with the
          // company's supersession count instead of the BOM — the same request-
          // timeout class this prefetch exists to remove (and, unchunked, a
          // bind-parameter overflow past ~65k ids). Successor trees loaded by
          // swapMadeSubAssembly re-enter through here, so each covers its own
          // redirect targets by induction.
          //
          // Deliberately NOT exhaustive: a configuration rule can replace a line's
          // itemId with an item no tree node names, and that item may be superseded
          // in turn. Those land on the per-material ensureItemsPrefetched below,
          // which is the safety net for every post-configuration id — this is a
          // batching hint, not the correctness boundary.
          const redirectTargets: string[] = [];
          for (const n of nodes) {
            const to = supersessionRedirect.get(n.data.itemId)?.to;
            if (to) redirectTargets.push(to);
          }

          await ensureItemsPrefetched(reader, [
            ...nodes.map((n) => n.data.itemId),
            ...redirectTargets
          ]);
          await ensureMakeMethodsPrefetched(
            reader,
            nodes.map((n) => n.data.materialMakeMethodId)
          );
        }

        await ensurePrefetched(db, methodTree);

        const getLaborAndOverheadRates = getRatesFromWorkCenters(workCenters);
        const getOutsideOperationRates =
          getRatesFromSupplierProcesses(supplierProcesses);

        // Get configuration code by field
        const configurationCodeByField = configurationRules.reduce<
          Record<string, string>
        >((acc, rule) => {
          acc[rule.field] = rule.code;
          return acc;
        }, {});

        await db.transaction().execute(async (trx) => {
          const insertedJobMaterialIds: string[] = [];
          if (isConfigured) {
            await trx
              .updateTable("job")
              .set({
                configuration: JSON.stringify(configuration),
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              })
              .where("id", "=", jobId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Delete existing jobMakeMethod, jobMakeMethodOperation, jobMakeMethodMaterial
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMakeMethod")
                  .where((eb) =>
                    eb.and([
                      eb("jobId", "=", jobId),
                      eb("parentMaterialId", "is not", null)
                    ])
                  )
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMaterial")
                  .where("jobId", "=", jobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            // Prevent cascade deletion of materials when only replacing operations
            !parts.billOfMaterial && parts.billOfProcess
              ? trx
                  .updateTable("jobMaterial")
                  .set({ jobOperationId: null })
                  .where("jobId", "=", jobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("jobOperation")
                  .where("jobId", "=", jobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            trx
              .updateTable("jobMakeMethod")
              .set({ version: makeMethod.version ?? 1 })
              .where("id", "=", jobMakeMethod.id)
              .where("companyId", "=", companyId)
              .execute()
          ]);

          // Default storage units are read by ensureItemsPrefetched above, per
          // tree, so a supersession successor's materials get a bin too.

          async function getConfiguredValue<T>({
            id,
            field,
            defaultValue
          }: {
            id: string;
            field: string;
            defaultValue: T;
          }): Promise<T> {
            if (!configurationCodeByField) return defaultValue;
            const fieldKey = getFieldKey(field, id);

            if (configurationCodeByField?.[fieldKey]) {
              try {
                const mod = await importTypeScript(
                  configurationCodeByField[fieldKey]
                );
                const result = await mod.configure(hydratedConfiguration);
                return (result ?? defaultValue) as T;
              } catch (err) {
                logger.error("configuration field resolver failed", {
                  error: String((err as Error)?.stack ?? err)
                });
                return defaultValue;
              }
            }

            return defaultValue;
          }

          // traverse method tree and create:
          // - jobMakeMethod
          // - jobMakeMethodOperation
          // - jobMakeMethodMaterial
          const deferredJobMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
            [];
          const deferredJobMaterialSteps: Database["public"]["Tables"]["jobMaterialStep"]["Insert"][] =
            [];

          async function traverseMethod(
            node: MethodTreeItem,
            parentJobMakeMethodId: string | null,
            parentEstimatedQuantity: number
          ) {
            // The tree handed to us is not necessarily the one prefetched up
            // front: a made-component supersession swap re-enters here on the
            // SUCCESSOR's tree (swapMadeSubAssembly). Covering it at the entry
            // point is what stops the `?? 0` / `?? []` fallbacks below from
            // silently zeroing a whole sub-assembly, for this caller and any
            // future one. `trx`, never `db` — the pool has one connection and
            // the transaction is holding it.
            await ensurePrefetched(trx, node);

            // For root node, targetQuantity equals the job quantity (parentEstimatedQuantity passed in)
            // For children, targetQuantity = parentEstimatedQuantity * quantityPerParent
            const targetQuantity = node.data.isRoot
              ? parentEstimatedQuantity
              : parentEstimatedQuantity * (node.data.quantity ?? 1);

            // Get scrap percentage for this node's item
            const nodeScrapPercentage =
              scrapPercentageByItemId.get(node.data.itemId) ?? 0;

            // Calculate quantities:
            // - For Make parts: estimatedQuantity = targetQuantity (good quantity, NOT including scrap)
            // - For Buy/Pick parts: estimatedQuantity = target + scrap (what we need to procure)
            // - scrapQuantity = targetQuantity * scrapRate (the extra needed for scrap)
            // - totalForChildren = target + scrap (passed to children for cascade)
            const nodeScrapQuantity = scrapAllowance(
              targetQuantity,
              nodeScrapPercentage
            );
            const totalWithScrap = targetQuantity + nodeScrapQuantity;

            // For Make: estimatedQuantity is the good quantity (without scrap)
            // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
            // operationQuantity is the total (including scrap); fractional
            // targets flow through — the scrap allowance is already whole
            const operationQuantity = totalWithScrap;
            // Pass total (including scrap) to children so cascade works correctly
            const totalQuantityForChildren = totalWithScrap;

            const nodeLevelConfigurationKey = `${
              node.data.materialMakeMethodId
            }:${node.data.isRoot ? "undefined" : node.data.methodMaterialId}`;

            let methodOperationsToJobOperations: Record<string, string> = {};
            // method step id -> new job step id, for copying the part ↔ step link (Phase 2)
            const methodStepsToJobSteps: Record<string, string> = {};

            // For child nodes, always include operations regardless of parts flags
            if (!node.data.isRoot || parts.billOfProcess) {
              const relatedOperations = {
                data:
                  operationsByMakeMethodId.get(
                    node.data.materialMakeMethodId
                  ) ?? []
              };

              let jobOperationsInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
                [];
              // The method operation each insert came from, kept index-aligned
              // with jobOperationsInserts. The inserted ids come back in the
              // order they were inserted, and that order matches neither the
              // length nor the sequence of relatedOperations.data: a blank
              // configured processId skips a row below, and a billOfProcess
              // configuration reorders and filters them. Pairing the returned
              // ids against the source array instead of this one attaches an
              // operation's tools, parameters and steps to the wrong job
              // operation — or reads past the end of the array and throws.
              let sourceOperations: typeof relatedOperations.data = [];
              for await (const op of relatedOperations?.data ?? []) {
                const [
                  processId,
                  procedureId,
                  workCenterId,
                  description,
                  setupTime,
                  setupUnit,
                  laborTime,
                  laborUnit,
                  machineTime,
                  machineUnit,
                  operationOrder,
                  operationType
                ] = await Promise.all([
                  getConfiguredValue({
                    id: op.id,
                    field: "processId",
                    defaultValue: op.processId
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "procedureId",
                    defaultValue: op.procedureId
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "workCenterId",
                    defaultValue: op.workCenterId
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "description",
                    defaultValue: op.description
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "setupTime",
                    defaultValue: op.setupTime
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "setupUnit",
                    defaultValue: op.setupUnit
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "laborTime",
                    defaultValue: op.laborTime
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "laborUnit",
                    defaultValue: op.laborUnit
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "machineTime",
                    defaultValue: op.machineTime
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "machineUnit",
                    defaultValue: op.machineUnit
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "operationOrder",
                    defaultValue: op.operationOrder
                  }),
                  getConfiguredValue({
                    id: op.id,
                    field: "operationType",
                    defaultValue: op.operationType
                  })
                ]);

                if (processId === "") continue;

                sourceOperations.push(op);
                jobOperationsInserts.push({
                  jobId,
                  jobMakeMethodId: parentJobMakeMethodId!,
                  processId,
                  procedureId,
                  workCenterId,
                  description,
                  setupTime,
                  setupUnit,
                  laborTime,
                  laborUnit,
                  machineTime,
                  machineUnit,
                  ...getLaborAndOverheadRates(processId, op.workCenterId),
                  order: op.order,
                  operationOrder,
                  operationType: normalizeOperationType(operationType),
                  // Carry the Assembly → BOP sync link so the MES can drive the
                  // animated instruction player on jobs made from a synced method.
                  assemblyInstructionId: op.assemblyInstructionId,
                  inspectionDocumentId: op.inspectionDocumentId,
                  operationSupplierProcessId: op.operationSupplierProcessId,
                  ...getOutsideOperationRates(
                    processId,
                    op.operationSupplierProcessId
                  ),
                  workInstruction: toJson(
                    !node.data.isRoot || parts.workInstructions
                      ? op.workInstruction
                      : {}
                  ),
                  targetQuantity,
                  operationQuantity,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });
              }

              const bopConfigurationKey = `billOfProcess:${nodeLevelConfigurationKey}`;
              let bopConfiguration: string[] | null = null;

              if (configurationCodeByField?.[bopConfigurationKey]) {
                const mod = await importTypeScript(
                  configurationCodeByField[bopConfigurationKey]
                );
                bopConfiguration = await mod.configure(hydratedConfiguration);
              }

              if (bopConfiguration) {
                // Reorder and filter both arrays together so an insert and the
                // method operation it came from stay at the same index.
                // findIndex keeps the original `.find` semantics: with duplicate
                // descriptions the first match wins.
                const configuredInserts: typeof jobOperationsInserts = [];
                const configuredSources: typeof sourceOperations = [];
                bopConfiguration.forEach((description, index) => {
                  const position = jobOperationsInserts.findIndex(
                    (operation) => operation.description === description
                  );
                  if (position !== -1) {
                    configuredInserts.push({
                      ...jobOperationsInserts[position]!,
                      order: index + 1
                    });
                    configuredSources.push(sourceOperations[position]!);
                  }
                });
                jobOperationsInserts = configuredInserts;
                sourceOperations = configuredSources;
              }

              if (jobOperationsInserts?.length > 0) {
                const operationIds = await trx
                  .insertInto("jobOperation")
                  .values(jobOperationsInserts)
                  .returning(["id"])
                  .execute();

                for (const [index, operation] of sourceOperations.entries()) {
                  const operationId = operationIds[index]?.id;

                  if (operationId) {
                    const {
                      methodOperationTool,
                      methodOperationParameter,
                      methodOperationStep,
                      procedureId
                    } = operation;

                    // Tool ids already inserted by the assembly-instruction
                    // copy — the method tool copy below must skip these or the
                    // job gets the same tool twice (once step-linked, once
                    // unlinked → the MES shows it on every step AND its step).
                    let assemblyToolIds: Set<string> = new Set();

                    if (procedureId) {
                      await insertProcedureDataForJobOperation(trx, {
                        operationId,
                        procedureId,
                        companyId,
                        userId
                      });
                    } else {
                      if (
                        (!node.data.isRoot || parts.parameters) &&
                        Array.isArray(methodOperationParameter) &&
                        methodOperationParameter.length > 0
                      ) {
                        const parameters = await Promise.all(
                          methodOperationParameter.map(async (param) => ({
                            operationId,
                            key: param.key,
                            value: await getConfiguredValue({
                              id: operation.id,
                              field: `parameter:${param.id}:value`,
                              defaultValue: param.value
                            }),
                            companyId,
                            createdBy: userId
                          }))
                        );

                        await trx
                          .insertInto("jobOperationParameter")
                          .values(parameters)
                          .execute();
                      }

                      if (operation.assemblyInstructionId) {
                        // Assembly ops inherit their steps from the linked
                        // instruction (the method only carries the pointer);
                        // material ↔ step links are flushed after the
                        // jobMaterial rows exist.
                        assemblyToolIds =
                          await insertAssemblyDataForJobOperation(trx, {
                            operationId,
                            assemblyInstructionId:
                              operation.assemblyInstructionId,
                            companyId,
                            userId
                          });
                        assemblyOperationsToLink.push({
                          operationId,
                          assemblyInstructionId: operation.assemblyInstructionId
                        });
                      } else if (
                        (!node.data.isRoot || parts.steps) &&
                        Array.isArray(methodOperationStep) &&
                        methodOperationStep.length > 0
                      ) {
                        const attributes = await Promise.all(
                          methodOperationStep.map(
                            async ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              description: toTiptapDoc(attribute.description),
                              operationId,
                              minValue: await getConfiguredValue({
                                id: operation.id,
                                field: `attribute:${_id}:minValue`,
                                defaultValue: attribute.minValue
                              }),
                              maxValue: await getConfiguredValue({
                                id: operation.id,
                                field: `attribute:${_id}:maxValue`,
                                defaultValue: attribute.maxValue
                              }),
                              companyId,
                              createdBy: userId
                            })
                          )
                        );

                        const insertedSteps = await trx
                          .insertInto("jobOperationStep")
                          .values(attributes)
                          .returning(["id"])
                          .execute();

                        // Bulk insert preserves order, so insertedSteps[i] ↔
                        // methodOperationStep[i]: record each method step -> new job step so
                        // materials can carry the part ↔ step link onto the job (Phase 2).
                        (methodOperationStep as Array<{ id?: string }>).forEach(
                          (s, i) => {
                            const newStepId = insertedSteps[i]?.id;
                            if (s?.id && newStepId)
                              methodStepsToJobSteps[s.id] = newStepId;
                          }
                        );
                        await copyStepSlides(
                          trx,
                          methodOperationStep,
                          insertedSteps,
                          "methodOperationStepSlide",
                          "jobOperationStepSlide",
                          companyId,
                          userId
                        );
                      }
                    }

                    // Tools after steps (Phase 2): the method-step -> job-step map is now
                    // populated, so a tool scoped to steps carries those links onto the job via
                    // jobOperationToolStep. Mirrors the material part ↔ step copy above. Tools
                    // the assembly-instruction copy already inserted are skipped (see above).
                    const toolsToCopy = (
                      Array.isArray(methodOperationTool)
                        ? methodOperationTool
                        : []
                    ).filter(
                      (tool: { toolId: string }) =>
                        !assemblyToolIds.has(tool.toolId)
                    );
                    if (
                      (!node.data.isRoot || parts.tools) &&
                      toolsToCopy.length > 0
                    ) {
                      const insertedTools = await trx
                        .insertInto("jobOperationTool")
                        .values(
                          toolsToCopy.map((tool) => ({
                            toolId: tool.toolId,
                            quantity: tool.quantity,
                            operationId,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .returning(["id"])
                        .execute();

                      // Tool ↔ step links (Phase 2, many-to-many). Bulk insert preserves order,
                      // so insertedTools[i] ↔ toolsToCopy[i]. A tool with no links applies
                      // to the whole operation (shown on every step in the MES).
                      const toolStepRows = toolsToCopy.flatMap((tool, i) => {
                        const jobOperationToolId = insertedTools[i]?.id;
                        if (!jobOperationToolId) return [];
                        const oldStepIds = (
                          (tool.methodOperationToolStep ?? []) as Array<{
                            methodOperationStepId: string | null;
                          }>
                        ).map((l) => l.methodOperationStepId);
                        return remapStepIds(
                          oldStepIds,
                          methodStepsToJobSteps
                        ).map((jobOperationStepId) => ({
                          jobOperationToolId,
                          jobOperationStepId
                        }));
                      });
                      if (toolStepRows.length > 0) {
                        await trx
                          .insertInto("jobOperationToolStep")
                          .values(toolStepRows)
                          .execute();
                      }
                    }
                  }
                }

                methodOperationsToJobOperations = sourceOperations.reduce<
                  Record<string, string>
                >((acc, op, index) => {
                  const operationId = operationIds[index]?.id;
                  if (operationId) {
                    acc[op.id!] = operationId;
                  }
                  return acc;
                }, {});
              }
            } // end if (parts.billOfProcess)

            if (parts.billOfMaterial) {
              const locationId = job.locationId;

              const mapMethodMaterialToJobMaterial = async (
                child: MethodTreeItem
              ) => {
                let [
                  itemId,
                  description,
                  quantity,
                  methodType,
                  unitOfMeasureCode
                ] = await Promise.all([
                  getConfiguredValue({
                    id: child.data.methodMaterialId,
                    field: "itemId",
                    defaultValue: child.data.itemId
                  }),
                  getConfiguredValue({
                    id: child.data.methodMaterialId,
                    field: "description",
                    defaultValue: child.data.description
                  }),
                  getConfiguredValue({
                    id: child.data.methodMaterialId,
                    field: "quantity",
                    defaultValue: child.data.quantity
                  }),
                  getConfiguredValue({
                    id: child.data.methodMaterialId,
                    field: "methodType",
                    defaultValue: child.data.methodType
                  }),
                  getConfiguredValue({
                    id: child.data.methodMaterialId,
                    field: "unitOfMeasureCode",
                    defaultValue: child.data.unitOfMeasureCode
                  })
                ]);

                if (itemId === "") return null;
                // A configured (or authored) quantity of 0 removes the line from
                // the BOM. Made sub-assemblies drop out of `configuredChildren`
                // below with the row, so their sub-tree is never exploded either.
                if (isZeroQuantity(quantity)) return null;

                let itemType = child.data.itemType;
                let unitCost = child.data.unitCost;
                let requiresSerialTracking =
                  child.data.itemTrackingType === "Serial";
                let requiresBatchTracking =
                  child.data.itemTrackingType === "Batch";

                // Supersession swap (Buy/Pick lines only). A Make-to-Order line
                // would need its successor's own sub-method re-exploded (a later
                // layer), so we leave those on the old part. The re-derive block
                // just below refreshes the successor's item fields automatically.
                let substitutedFromItemId: string | null = null;
                let substitutionFactor: number | null = null;
                // Captured before the swap so the revert below can undo it whole.
                const quantityBeforeSupersession = quantity;
                const methodTypeBeforeSupersession = methodType;
                // Post-configuration, pre-supersession. A configuration rule may
                // already have moved this line off the BOM's item, and that choice
                // has to survive a failed successor lookup — see the fallback chain
                // below.
                const configuredItemId = itemId;
                if (methodType !== "Make to Order") {
                  const redirect = supersessionRedirect.get(itemId);
                  if (redirect) {
                    substitutedFromItemId = itemId;
                    substitutionFactor = redirect.factor;
                    itemId = redirect.to;
                    quantity = quantity * redirect.factor;
                  }
                } else {
                  const pulledFrom = resolveMadeLinePull(
                    itemId,
                    quantity,
                    supersessionContext
                  );
                  if (pulledFrom) {
                    methodType = "Pull from Inventory";
                    if (pulledFrom.itemId !== itemId) {
                      substitutedFromItemId = itemId;
                      substitutionFactor = pulledFrom.factor;
                      itemId = pulledFrom.itemId;
                      quantity = quantity * pulledFrom.factor;
                    }
                  }
                }

                // Fall back in order of preference: the successor, then whatever a
                // configuration rule chose, then the BOM's own item. Reverting
                // straight to `child.data.itemId` discarded the configuration
                // rule's decision, which the supersession never overrode — it only
                // redirected the item that rule had already picked.
                //
                // Each candidate is READ before it is accepted, so `itemId` and the
                // fields derived from it can never disagree. `child.data.itemId`
                // needs no read: its fields are the defaults already in scope.
                // What this row WOULD be for if every lookup succeeds.
                const intendedItemId = itemId;
                for (const candidate of [
                  ...new Set([itemId, configuredItemId, child.data.itemId])
                ]) {
                  itemId = candidate;
                  if (candidate === child.data.itemId) break;
                  const item = await readItemWithCost(
                    trx,
                    candidate,
                    companyId
                  );
                  if (item) {
                    itemType = item.type;
                    unitCost =
                      item.itemCost[0]?.unitCost ?? child.data.unitCost;
                    if (description === child.data.description) {
                      description = item.name;
                    }
                    requiresSerialTracking = item.itemTrackingType === "Serial";
                    requiresBatchTracking = item.itemTrackingType === "Batch";
                    break;
                  }
                }

                if (itemId !== intendedItemId) {
                  // The swap could not be completed, so undo it WHOLLY. Reverting
                  // only `itemId` left the row on a different item while KEEPING
                  // the successor's factor-scaled quantity and a
                  // `substitutedFromItemId` that no longer described it — a
                  // plausible-looking but wrong quantity nothing downstream can
                  // detect or repair.
                  quantity = quantityBeforeSupersession;
                  methodType = methodTypeBeforeSupersession;
                  substitutedFromItemId = null;
                  substitutionFactor = null;
                }

                // `itemId` here is post-configuration and post-supersession, so
                // it can be an item no tree node named — a configuration rule may
                // return any item id. Cover it before reading, or its scrap
                // percentage silently resolves to 0 and sticks.
                await ensureItemsPrefetched(trx, [itemId]);

                // Get scrap percentage for this item
                const itemScrapPercentage =
                  scrapPercentageByItemId.get(itemId) ?? 0;

                // Calculate scrap quantities for this material
                // targetQuantity for this child = parent's total (including scrap) * quantity per parent
                const childTargetQuantity = totalQuantityForChildren * quantity;
                // scrapQuantity = portion attributable to scrap
                const childScrapQuantity = scrapAllowance(
                  childTargetQuantity,
                  itemScrapPercentage
                );
                const childTotalWithScrap =
                  childTargetQuantity + childScrapQuantity;
                // For Make: estimatedQuantity is the good quantity (without scrap)
                // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
                const childEstimatedQuantity =
                  methodType === "Make to Order"
                    ? childTargetQuantity
                    : childTotalWithScrap;

                return {
                  jobId,
                  jobMakeMethodId: parentJobMakeMethodId!,
                  jobOperationId:
                    methodOperationsToJobOperations[child.data.operationId],
                  // Transient (Phase 2, many-to-many): the part ↔ step links (with their
                  // per-step quantity), remapped onto the job's steps. Stripped before
                  // insert; used to build jobMaterialStep rows.
                  __stepLinks: remapStepLinks(
                    (
                      child.data as {
                        methodOperationStepIds?: Array<
                          | string
                          | { id?: string | null; quantity?: number | null }
                        > | null;
                      }
                    ).methodOperationStepIds,
                    methodStepsToJobSteps
                  ),
                  itemId,
                  itemType,
                  kit: methodType === "Make to Order" && child.data.kit,
                  methodType,
                  order: child.data.order,
                  description,
                  quantity,
                  scrapQuantity: childScrapQuantity,
                  estimatedQuantity: childEstimatedQuantity,
                  storageUnitId: locationId
                    ? // The bin explicitly set on the BOM line stays keyed on the
                      // line, but the default bin belongs to the item this row is
                      // actually for — `itemId`, after any supersession or
                      // configuration swap. Keyed on child.data.itemId a swapped
                      // line took the predecessor's bin, or none when only the
                      // successor had one.
                      // @ts-ignore
                      (child.data.storageUnitIds?.[locationId] as string) ||
                      defaultStorageUnitByItemId.get(itemId)
                    : undefined,
                  requiresSerialTracking,
                  requiresBatchTracking,
                  unitOfMeasureCode,
                  unitCost: unitCost ?? 0,
                  itemScrapPercentage,
                  substitutedFromItemId,
                  substitutionFactor,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                };
              };

              const jobMaterialResults = await Promise.all(
                node.children.map(mapMethodMaterialToJobMaterial)
              );
              const validJobMaterialIndices = jobMaterialResults.reduce<
                number[]
              >((acc, m, i) => {
                if (m !== null) acc.push(i);
                return acc;
              }, []);
              let materialsWithConfiguredFields = jobMaterialResults.filter(
                (m): m is NonNullable<typeof m> => m !== null
              );
              let configuredChildren = validJobMaterialIndices.map(
                (i) => node.children[i]!
              );

              const bomConfigurationKey = `billOfMaterial:${nodeLevelConfigurationKey}`;
              let bomConfiguration: string[] | null = null;

              if (configurationCodeByField?.[bomConfigurationKey]) {
                const mod = await importTypeScript(
                  configurationCodeByField[bomConfigurationKey]
                );
                bomConfiguration = await mod.configure(hydratedConfiguration);
              }

              if (bomConfiguration) {
                const pairByReadableId = new Map<
                  string,
                  {
                    material: (typeof materialsWithConfiguredFields)[number];
                    child: MethodTreeItem;
                  }
                >();
                configuredChildren.forEach((child, i) => {
                  const material = materialsWithConfiguredFields[i];
                  if (!material) return;
                  const data = child!.data as {
                    itemReadableId?: string | null;
                    readableIdWithRevision?: string | null;
                  };
                  for (const key of [
                    data.readableIdWithRevision,
                    data.itemReadableId
                  ]) {
                    if (key && !pairByReadableId.has(key)) {
                      pairByReadableId.set(key, { material, child });
                    }
                  }
                });
                const pairs = bomConfiguration.flatMap((readableId, index) => {
                  const pair = pairByReadableId.get(readableId);
                  return pair
                    ? [
                        {
                          material: { ...pair.material, order: index + 1 },
                          child: pair.child
                        }
                      ]
                    : [];
                });
                materialsWithConfiguredFields = pairs.map(
                  (pair) => pair.material
                );
                configuredChildren = pairs.map((pair) => pair.child);
              }

              const madeMaterials = materialsWithConfiguredFields.filter(
                (material) => material.methodType === "Make to Order"
              );

              const pickedOrBoughtMaterials =
                materialsWithConfiguredFields.filter(
                  (material) => material.methodType !== "Make to Order"
                );

              const madeChildren = configuredChildren.filter(
                (_, i) =>
                  materialsWithConfiguredFields[i]?.methodType ===
                  "Make to Order"
              );

              if (madeMaterials.length > 0) {
                const madeMaterialsWithIds = madeMaterials.map((m) => ({
                  ...m,
                  id: nanoid()
                }));
                insertedJobMaterialIds.push(
                  ...madeMaterialsWithIds.map((m) => m.id)
                );

                await trx
                  .insertInto("jobMaterial")
                  .values(
                    madeMaterialsWithIds.map((m) => {
                      const { __stepLinks, ...rest } = m as typeof m & {
                        __stepLinks?: {
                          stepId: string;
                          quantity: number | null;
                        }[];
                      };
                      return rest;
                    })
                  )
                  .execute();

                // Part ↔ step links (Phase 2, many-to-many): the transient __stepLinks carried
                // the remapped job step ids + per-step quantity; write them to jobMaterialStep
                // now that the material id exists. No links = whole operation (shown on every
                // step in the MES).
                const madeStepRows = madeMaterialsWithIds.flatMap((m) =>
                  (
                    (
                      m as {
                        __stepLinks?: {
                          stepId: string;
                          quantity: number | null;
                        }[];
                      }
                    ).__stepLinks ?? []
                  ).map((link) => ({
                    jobMaterialId: m.id,
                    jobOperationStepId: link.stepId,
                    quantity: link.quantity
                  }))
                );
                if (madeStepRows.length > 0) {
                  await trx
                    .insertInto("jobMaterialStep")
                    .values(madeStepRows)
                    .execute();
                }

                const newMakeMethodIds = madeChildren.map(() => nanoid());
                await renameMakeMethods(trx, {
                  table: "jobMakeMethod",
                  companyId,
                  rows: madeChildren.map((_, index) => ({
                    parentMaterialId: madeMaterialsWithIds[index]!.id,
                    id: newMakeMethodIds[index]!
                  }))
                });

                for (const [index, child] of madeChildren.entries()) {
                  const materialId = madeMaterialsWithIds[index]!.id;
                  const newMakeMethodId = newMakeMethodIds[index]!;

                  // Get the total quantity (estimated + scrap) for this child material
                  // This is what we pass to children for the cascade
                  const material = madeMaterials[index];
                  const childTotalForCascade =
                    (material?.estimatedQuantity ?? 0) +
                    (material?.scrapQuantity ?? 0);

                  // Made sub-assembly supersession: if this made component has an
                  // effective successor that is ITSELF a made item, point the job
                  // material at the successor and explode the SUCCESSOR's method
                  // (not the old part's). A Make -> Buy successor is a structural
                  // flip we leave on the old part (handled/flagged elsewhere).
                  const madeSwapHandled = await swapMadeSubAssembly({
                    trx,
                    companyId,
                    child,
                    material,
                    materialId,
                    locationId: job.locationId ?? "",
                    supersessionRedirect,
                    newMakeMethodId,
                    traverseMethod
                  });

                  // prevent an infinite loop
                  if (!madeSwapHandled && child!.data.itemId !== itemId) {
                    await traverseMethod(
                      child,
                      newMakeMethodId,
                      childTotalForCascade || 1
                    );
                  }
                }
              }

              if (pickedOrBoughtMaterials.length > 0) {
                // Assign ids up front so part ↔ step links (Phase 2, many-to-many) can reference
                // each row; strip the transient __stepLinks before inserting the material.
                const pickedWithIds = pickedOrBoughtMaterials.map((m) => ({
                  ...m,
                  id: (m as { id?: string }).id ?? nanoid()
                }));
                insertedJobMaterialIds.push(...pickedWithIds.map((m) => m.id));
                // Inserted once, after the walk: nothing below reads these rows,
                // and their insert triggers only validate.
                deferredJobMaterials.push(
                  ...pickedWithIds.map((m) => {
                    const { __stepLinks, ...rest } = m as typeof m & {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    };
                    return rest;
                  })
                );

                const pickedStepRows = pickedWithIds.flatMap((m) =>
                  (
                    (
                      m as {
                        __stepLinks?: {
                          stepId: string;
                          quantity: number | null;
                        }[];
                      }
                    ).__stepLinks ?? []
                  ).map((link) => ({
                    jobMaterialId: m.id,
                    jobOperationStepId: link.stepId,
                    quantity: link.quantity
                  }))
                );
                deferredJobMaterialSteps.push(...pickedStepRows);
              }
            } // end if (parts.billOfMaterial)
          }

          // Start traversal with job quantity as the root's target/parent estimated quantity
          await traverseMethod(methodTree, jobMakeMethod.id, job.quantity ?? 1);
          await insertDeferredJobMaterials(
            trx,
            deferredJobMaterials,
            deferredJobMaterialSteps
          );

          await linkAssemblyStepMaterialsForJobOperations(
            trx,
            assemblyOperationsToLink,
            companyId
          );

          await settleConsumeFirstLines({
            trx,
            companyId,
            jobId: jobId,
            jobMaterialIds: insertedJobMaterialIds,
            locationId: job.locationId,
            asOfDate: jobBuildDate(job)
          });
        });

        break;
      }
      case "itemToJobMakeMethod": {
        const jobMakeMethodId = targetId;

        if (!jobMakeMethodId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;
        // Assembly ops whose steps were materialized from an instruction —
        // material ↔ step links flush after the traversal inserts the
        // jobMaterial rows.
        const assemblyOperationsToLink: Array<{
          operationId: string;
          assemblyInstructionId: string;
        }> = [];

        // A chosen version overrides the default active-method lookup; it is
        // re-read under itemId + companyId so a foreign or mismatched
        // makeMethod id can never be exploded.
        const makeMethod = versionId
          ? await single(db, "makeMethod", { id: versionId, itemId, companyId })
          : await single(db, "activeMakeMethods", { itemId, companyId });
        const jobMakeMethod = await single(db, "jobMakeMethod", {
          id: jobMakeMethodId,
          companyId
        });
        const workCenters = await many(db, "workCenters", { companyId });
        const supplierProcesses = await many(db, "supplierProcess", {
          companyId
        });

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error || !jobMakeMethod.data) {
          throw new Error("Failed to get job make method");
        }

        // FIXME: hydrated here but never applied — this make-method path does
        // not run configuration rules (itemToJob does). Applying them is a
        // behavior change for its own PR.
        // biome-ignore lint/correctness/noUnusedVariables: see FIXME above
        const hydratedConfiguration = await hydrateConfiguration(
          db,
          configuration,
          itemId,
          companyId
        );

        // Get parent estimated quantity context
        let parentEstimatedQuantity = 1;
        if (jobMakeMethod.data.parentMaterialId) {
          // This is a sub-item - get the parent material's estimated quantity
          const parentMaterial = await single(db, "jobMaterial", {
            id: jobMakeMethod.data.parentMaterialId,
            companyId
          });
          parentEstimatedQuantity = parentMaterial.data?.estimatedQuantity ?? 1;
        } else {
          // This is the root - get job's quantity
          const rootJob = await single(db, "job", {
            id: jobMakeMethod.data.jobId,
            companyId
          });
          parentEstimatedQuantity = rootJob.data?.quantity ?? 1;
        }

        const job = await single(db, "job", {
          id: jobMakeMethod.data.jobId,
          companyId
        });
        const methodTrees = await getMethodTree(db, makeMethod.data.id!);
        const configurationRules = isConfigured
          ? await many(db, "configurationRule", { itemId, companyId })
          : { data: [] as Tables["configurationRule"]["Row"][] };

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new NotFoundError("Method tree not found");

        // Loaded ONCE per request, before the transaction — as itemToJob does.
        // This read pages the company's whole itemSupersession table, and it used
        // to sit inside traverseMethod, so a BOM of N nodes issued N full-table
        // reads sequentially inside the transaction holding the pool's single
        // connection. The map depends only on the company and the job's build
        // date, both fixed for the request, so per-node reload bought nothing.
        const supersessionContext = await loadSupersessionRedirect(
          db,
          companyId,
          job.data
        );
        const supersessionRedirect = supersessionContext.redirect;
        const itemDefaults = createItemDefaults(
          companyId,
          job.data?.locationId
        );

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

        // Get configuration code by field
        // biome-ignore lint/correctness/noUnusedVariables: unapplied configuration, see FIXME above
        const configurationCodeByField = configurationRules.data?.reduce<
          Record<string, string>
        >((acc, rule) => {
          acc[rule.field] = rule.code;
          return acc;
        }, {});

        await db.transaction().execute(async (trx) => {
          await itemDefaults.load(
            trx,
            treeItemIds(methodTree, supersessionRedirect)
          );
          const insertedJobMaterialIds: string[] = [];
          // Delete existing jobMakeMethodOperation, jobMakeMethodMaterial
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMaterial")
                  .where("jobMakeMethodId", "=", jobMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            // Prevent cascade deletion of materials when only replacing operations
            !parts.billOfMaterial && parts.billOfProcess
              ? trx
                  .updateTable("jobMaterial")
                  .set({ jobOperationId: null })
                  .where("jobMakeMethodId", "=", jobMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("jobOperation")
                  .where("jobMakeMethodId", "=", jobMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            trx
              .updateTable("jobMakeMethod")
              .set({ version: makeMethod.data.version ?? 1 })
              .where("id", "=", jobMakeMethodId)
              .where("companyId", "=", companyId)
              .execute()
          ]);

          // traverse method tree and create:
          // - jobMakeMethod
          // - jobMakeMethodOperation
          // - jobMakeMethodMaterial
          const deferredJobMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
            [];
          const deferredJobMaterialSteps: Database["public"]["Tables"]["jobMaterialStep"]["Insert"][] =
            [];

          async function traverseMethod(
            node: MethodTreeItem,
            parentJobMakeMethodId: string | null,
            nodeParentEstimatedQuantity: number
          ) {
            // Calculate target and estimated quantities for this node
            const targetQuantity = node.data.isRoot
              ? nodeParentEstimatedQuantity
              : nodeParentEstimatedQuantity * (node.data.quantity ?? 1);

            // Get scrap percentage for this node's item
            const nodeScrapPercentage = await itemDefaults.scrapPercentage(
              trx,
              node.data.itemId
            );

            // Calculate quantities:
            // - For Make parts: estimatedQuantity = targetQuantity (good quantity, NOT including scrap)
            // - For Buy/Pick parts: estimatedQuantity = target + scrap (what we need to procure)
            const nodeScrapQuantity = scrapAllowance(
              targetQuantity,
              nodeScrapPercentage
            );
            const totalWithScrap = targetQuantity + nodeScrapQuantity;
            // operationQuantity is the total (including scrap); fractional
            // targets flow through — the scrap allowance is already whole
            const operationQuantity = totalWithScrap;
            const totalQuantityForChildren = totalWithScrap;

            const relatedOperations = {
              data: await readMethodOperations(
                trx,
                [node.data.materialMakeMethodId],
                companyId
              )
            };

            const jobOperationsInserts =
              relatedOperations?.data?.map((op) => ({
                jobId: jobMakeMethod.data?.jobId!,
                jobMakeMethodId: parentJobMakeMethodId!,
                processId: op.processId,
                procedureId: op.procedureId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                ...getLaborAndOverheadRates(op.processId, op.workCenterId),
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                // Carry the Assembly → BOP sync link so the MES can drive the
                // animated instruction player on jobs made from a synced method.
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                operationUnitCost: op.operationUnitCost ?? 0,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  op.processId,
                  op.operationSupplierProcessId
                ),
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                targetQuantity,
                operationQuantity,
                companyId,
                createdBy: userId,
                customFields: {}
              })) ?? [];

            let methodOperationsToJobOperations: Record<string, string> = {};
            // method step id -> new job step id, for copying the part ↔ step link (Phase 2)
            const methodStepsToJobSteps: Record<string, string> = {};

            if (parts.billOfProcess) {
              if (jobOperationsInserts?.length > 0) {
                const operationIds = await trx
                  .insertInto("jobOperation")
                  .values(jobOperationsInserts)
                  .returning(["id"])
                  .execute();

                for (const [index, operation] of (
                  relatedOperations.data ?? []
                ).entries()) {
                  const operationId = operationIds[index]!.id;

                  if (operationId) {
                    const {
                      methodOperationTool,
                      methodOperationParameter,
                      methodOperationStep,
                      procedureId
                    } = operation;

                    // Tool ids already inserted by the assembly-instruction
                    // copy — the method tool copy below must skip these or the
                    // job gets the same tool twice (once step-linked, once
                    // unlinked → the MES shows it on every step AND its step).
                    let assemblyToolIds: Set<string> = new Set();

                    if (procedureId) {
                      await insertProcedureDataForJobOperation(trx, {
                        operationId,
                        procedureId,
                        companyId,
                        userId
                      });
                    } else {
                      if (
                        parts.parameters &&
                        Array.isArray(methodOperationParameter) &&
                        methodOperationParameter.length > 0
                      ) {
                        await trx
                          .insertInto("jobOperationParameter")
                          .values(
                            methodOperationParameter.map((param) => ({
                              operationId,
                              key: param.key,
                              value: param.value,
                              companyId,
                              createdBy: userId
                            }))
                          )
                          .execute();
                      }

                      if (operation.assemblyInstructionId) {
                        // Assembly ops inherit their steps from the linked
                        // instruction (the method only carries the pointer);
                        // material ↔ step links are flushed after the
                        // jobMaterial rows exist.
                        assemblyToolIds =
                          await insertAssemblyDataForJobOperation(trx, {
                            operationId,
                            assemblyInstructionId:
                              operation.assemblyInstructionId,
                            companyId,
                            userId
                          });
                        assemblyOperationsToLink.push({
                          operationId,
                          assemblyInstructionId: operation.assemblyInstructionId
                        });
                      } else if (
                        parts.steps &&
                        Array.isArray(methodOperationStep) &&
                        methodOperationStep.length > 0
                      ) {
                        const insertedSteps = await trx
                          .insertInto("jobOperationStep")
                          .values(
                            methodOperationStep.map(
                              ({ id: _id, ...attribute }) => ({
                                ...attribute,
                                description: toTiptapDoc(attribute.description),
                                operationId,
                                companyId,
                                createdBy: userId
                              })
                            )
                          )
                          .returning(["id"])
                          .execute();

                        // Bulk insert preserves order, so insertedSteps[i] ↔
                        // methodOperationStep[i]: record each method step -> new job step so
                        // materials can carry the part ↔ step link onto the job (Phase 2).
                        (methodOperationStep as Array<{ id?: string }>).forEach(
                          (s, i) => {
                            const newStepId = insertedSteps[i]?.id;
                            if (s?.id && newStepId)
                              methodStepsToJobSteps[s.id] = newStepId;
                          }
                        );
                        await copyStepSlides(
                          trx,
                          methodOperationStep,
                          insertedSteps,
                          "methodOperationStepSlide",
                          "jobOperationStepSlide",
                          companyId,
                          userId
                        );
                      }
                    }

                    // Tools after steps (Phase 2): the method-step -> job-step map is now
                    // populated, so a tool scoped to steps carries those links onto the job via
                    // jobOperationToolStep. Mirrors the material part ↔ step copy above. Tools
                    // the assembly-instruction copy already inserted are skipped (see above).
                    const toolsToCopy = (
                      Array.isArray(methodOperationTool)
                        ? methodOperationTool
                        : []
                    ).filter(
                      (tool: { toolId: string }) =>
                        !assemblyToolIds.has(tool.toolId)
                    );
                    if (parts.tools && toolsToCopy.length > 0) {
                      const insertedTools = await trx
                        .insertInto("jobOperationTool")
                        .values(
                          toolsToCopy.map((tool) => ({
                            toolId: tool.toolId,
                            quantity: tool.quantity,
                            operationId,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .returning(["id"])
                        .execute();

                      // Tool ↔ step links (Phase 2, many-to-many). Bulk insert preserves order,
                      // so insertedTools[i] ↔ toolsToCopy[i]. A tool with no links applies
                      // to the whole operation (shown on every step in the MES).
                      const toolStepRows = toolsToCopy.flatMap((tool, i) => {
                        const jobOperationToolId = insertedTools[i]?.id;
                        if (!jobOperationToolId) return [];
                        const oldStepIds = (
                          (tool.methodOperationToolStep ?? []) as Array<{
                            methodOperationStepId: string | null;
                          }>
                        ).map((l) => l.methodOperationStepId);
                        return remapStepIds(
                          oldStepIds,
                          methodStepsToJobSteps
                        ).map((jobOperationStepId) => ({
                          jobOperationToolId,
                          jobOperationStepId
                        }));
                      });
                      if (toolStepRows.length > 0) {
                        await trx
                          .insertInto("jobOperationToolStep")
                          .values(toolStepRows)
                          .execute();
                      }
                    }
                  }
                }

                methodOperationsToJobOperations =
                  relatedOperations.data?.reduce<Record<string, string>>(
                    (acc, op, index) => {
                      if (operationIds[index]!.id) {
                        acc[op.id!] = operationIds[index]!.id!;
                      }
                      return acc;
                    },
                    {}
                  ) ?? {};
              }
            } // end if (parts.billOfProcess)

            if (parts.billOfMaterial) {
              const mapMethodMaterialToJobMaterial = async (
                child: MethodTreeItem
              ) => {
                // Resolve the supersession FIRST, so every field below derives
                // from the item this row ENDS UP being for. This used to run as a
                // second pass over the finished rows, which meant each new derived
                // field silently inherited the predecessor's value unless someone
                // remembered to add it to that pass's patch list — the scrap rate
                // was read here from the OLD item and never revisited, so a swapped
                // line costed the predecessor's scrap forever (the column is NOT
                // NULL, and recalculate only re-derives from NULL). Swapping up
                // front is what itemToJob already does, and it makes the whole
                // class of bug unreachable rather than fixing one instance of it.
                // Buy/Pick only — resolveJobMaterialSupersession returns null for
                // Make to Order, which swapMadeSubAssembly handles during its own
                // explosion.
                const pulledFrom =
                  child.data.methodType === "Make to Order"
                    ? resolveMadeLinePull(
                        child.data.itemId,
                        child.data.quantity ?? 1,
                        supersessionContext
                      )
                    : null;
                const methodType = pulledFrom
                  ? "Pull from Inventory"
                  : child.data.methodType;
                const supersession =
                  pulledFrom && pulledFrom.itemId === child.data.itemId
                    ? null
                    : await resolveJobMaterialSupersession(
                        trx,
                        companyId,
                        pulledFrom
                          ? new Map([
                              [
                                child.data.itemId,
                                {
                                  to: pulledFrom.itemId,
                                  factor: pulledFrom.factor
                                }
                              ]
                            ])
                          : supersessionRedirect,
                        { itemId: child.data.itemId, methodType }
                      );
                const itemId = supersession?.itemId ?? child.data.itemId;
                // 1 old part = `factor` successors. The line's methodType and unit
                // of measure are deliberately preserved; the factor translates the
                // quantity.
                const quantityPerParent =
                  (child.data.quantity ?? 1) * (supersession?.factor ?? 1);

                // Get scrap percentage for this item
                const itemScrapPercentage = await itemDefaults.scrapPercentage(
                  trx,
                  itemId
                );

                // Calculate scrap quantities for this material
                // Use totalQuantityForChildren (parent's total including scrap) for child calculations
                const childTargetQuantity =
                  totalQuantityForChildren * quantityPerParent;
                const childScrapQuantity = scrapAllowance(
                  childTargetQuantity,
                  itemScrapPercentage
                );
                const childTotalWithScrap =
                  childTargetQuantity + childScrapQuantity;
                // For Make: estimatedQuantity is the good quantity (without scrap)
                // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
                const childEstimatedQuantity =
                  methodType === "Make to Order"
                    ? childTargetQuantity
                    : childTotalWithScrap;

                return {
                  jobId: jobMakeMethod.data?.jobId!,
                  jobMakeMethodId: parentJobMakeMethodId!,
                  jobOperationId:
                    methodOperationsToJobOperations[child.data.operationId],
                  // Transient (Phase 2, many-to-many): the part ↔ step links (with their
                  // per-step quantity), remapped onto the job's steps. Stripped before
                  // insert; used to build jobMaterialStep rows.
                  __stepLinks: remapStepLinks(
                    (
                      child.data as {
                        methodOperationStepIds?: Array<
                          | string
                          | { id?: string | null; quantity?: number | null }
                        > | null;
                      }
                    ).methodOperationStepIds,
                    methodStepsToJobSteps
                  ),
                  itemId,
                  kit: methodType === "Make to Order" && child.data.kit,
                  itemType: supersession?.itemType ?? child.data.itemType,
                  methodType,
                  order: child.data.order,
                  description:
                    supersession?.description ?? child.data.description,
                  quantity: quantityPerParent,
                  scrapQuantity: childScrapQuantity,
                  estimatedQuantity: childEstimatedQuantity,
                  requiresBatchTracking:
                    supersession?.requiresBatchTracking ??
                    child.data.itemTrackingType === "Batch",
                  requiresSerialTracking:
                    supersession?.requiresSerialTracking ??
                    child.data.itemTrackingType === "Serial",
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  // Branch on WHETHER a swap happened, not just on the successor
                  // having a cost. `supersession?.unitCost ?? child.data.unitCost`
                  // valued a successor row at the RETIRED part's cost whenever the
                  // successor had no itemCost row — a plausible number for the
                  // wrong item. 0 is at least visibly missing.
                  unitCost: supersession
                    ? (supersession.unitCost ?? 0)
                    : (child.data.unitCost ?? 0),
                  itemScrapPercentage,
                  substitutedFromItemId:
                    supersession?.substitutedFromItemId ?? null,
                  substitutionFactor: supersession?.factor ?? null,
                  // The bin belongs to the item this row is actually for — the
                  // post-swap `itemId`. An explicit bin on the BOM line still wins.
                  storageUnitId: await itemDefaults.storageUnitId(
                    trx,
                    itemId,
                    // @ts-ignore: storageUnitIds is a dynamic field
                    child.data.storageUnitIds?.[job.data.locationId] ??
                      undefined
                  ),
                  companyId,
                  createdBy: userId,
                  customFields: {}
                };
              };

              const madeMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
                [];
              const madeChildren: MethodTreeItem[] = [];
              const pickedOrBoughtMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
                [];

              for await (const child of node.children) {
                if (isZeroQuantity(child.data.quantity)) continue;
                const material = await mapMethodMaterialToJobMaterial(child);
                if (material.methodType === "Make to Order") {
                  madeMaterials.push(material);
                  madeChildren.push(child);
                } else {
                  pickedOrBoughtMaterials.push(material);
                }
              }

              // The supersession swap happens inside mapMethodMaterialToJobMaterial,
              // before any field derives from the item — there is deliberately no
              // second pass here. Made materials are left for their own
              // sub-explosion (swapMadeSubAssembly).

              if (madeMaterials.length > 0) {
                const madeMaterialsWithIds = madeMaterials.map((m) => ({
                  ...m,
                  id: nanoid()
                }));
                insertedJobMaterialIds.push(
                  ...madeMaterialsWithIds.map((m) => m.id)
                );

                await trx
                  .insertInto("jobMaterial")
                  .values(
                    madeMaterialsWithIds.map((m) => {
                      const { __stepLinks, ...rest } = m as typeof m & {
                        __stepLinks?: {
                          stepId: string;
                          quantity: number | null;
                        }[];
                      };
                      return rest;
                    })
                  )
                  .execute();

                // Part ↔ step links (Phase 2, many-to-many): the transient __stepLinks carried
                // the remapped job step ids + per-step quantity; write them to jobMaterialStep
                // now that the material id exists. No links = whole operation (shown on every
                // step in the MES).
                const madeStepRows = madeMaterialsWithIds.flatMap((m) =>
                  (
                    (
                      m as {
                        __stepLinks?: {
                          stepId: string;
                          quantity: number | null;
                        }[];
                      }
                    ).__stepLinks ?? []
                  ).map((link) => ({
                    jobMaterialId: m.id,
                    jobOperationStepId: link.stepId,
                    quantity: link.quantity
                  }))
                );
                if (madeStepRows.length > 0) {
                  await trx
                    .insertInto("jobMaterialStep")
                    .values(madeStepRows)
                    .execute();
                }

                const newMakeMethodIds = madeChildren.map(() => nanoid());
                await renameMakeMethods(trx, {
                  table: "jobMakeMethod",
                  companyId,
                  rows: madeChildren.map((_, index) => ({
                    parentMaterialId: madeMaterialsWithIds[index]!.id,
                    id: newMakeMethodIds[index]!
                  }))
                });

                for (const [index, child] of madeChildren.entries()) {
                  const materialId = madeMaterialsWithIds[index]!.id;
                  const newMakeMethodId = newMakeMethodIds[index]!;

                  // Get the total quantity (estimated + scrap) for this child material
                  // This is what we pass to children for the cascade
                  const material = madeMaterials[index];
                  const childTotalForCascade =
                    (material?.estimatedQuantity ?? 0) +
                    (material?.scrapQuantity ?? 0);

                  // Made sub-assembly supersession (see itemToJob for rationale):
                  // if a made component has an effective successor that is itself
                  // made, point the job material at the successor and explode the
                  // SUCCESSOR's method instead of the old part's.
                  const madeSwapHandled = await swapMadeSubAssembly({
                    trx,
                    companyId,
                    child,
                    material,
                    materialId,
                    locationId: job.data?.locationId ?? "",
                    supersessionRedirect,
                    newMakeMethodId,
                    traverseMethod
                  });

                  // prevent an infinite loop
                  if (!madeSwapHandled && child.data.itemId !== itemId) {
                    await traverseMethod(
                      child,
                      newMakeMethodId,
                      childTotalForCascade || 1
                    );
                  }
                }
              }

              if (pickedOrBoughtMaterials.length > 0) {
                // Assign ids up front so part ↔ step links (Phase 2, many-to-many) can reference
                // each row; strip the transient __stepLinks before inserting the material.
                const pickedWithIds = pickedOrBoughtMaterials.map((m) => ({
                  ...m,
                  id: (m as { id?: string }).id ?? nanoid()
                }));
                insertedJobMaterialIds.push(...pickedWithIds.map((m) => m.id));
                // Inserted once, after the walk: nothing below reads these rows,
                // and their insert triggers only validate.
                deferredJobMaterials.push(
                  ...pickedWithIds.map((m) => {
                    const { __stepLinks, ...rest } = m as typeof m & {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    };
                    return rest;
                  })
                );

                const pickedStepRows = pickedWithIds.flatMap((m) =>
                  (
                    (
                      m as {
                        __stepLinks?: {
                          stepId: string;
                          quantity: number | null;
                        }[];
                      }
                    ).__stepLinks ?? []
                  ).map((link) => ({
                    jobMaterialId: m.id,
                    jobOperationStepId: link.stepId,
                    quantity: link.quantity
                  }))
                );
                deferredJobMaterialSteps.push(...pickedStepRows);
              }
            } // end if (parts.billOfMaterial)
          }

          // Start traversal with the parent's estimated quantity
          await traverseMethod(
            methodTree,
            jobMakeMethod.data.id,
            parentEstimatedQuantity
          );
          await insertDeferredJobMaterials(
            trx,
            deferredJobMaterials,
            deferredJobMaterialSteps
          );

          await linkAssemblyStepMaterialsForJobOperations(
            trx,
            assemblyOperationsToLink,
            companyId
          );

          await settleConsumeFirstLines({
            trx,
            companyId,
            jobId: jobMakeMethod.data.jobId,
            jobMaterialIds: insertedJobMaterialIds,
            locationId: job.data?.locationId,
            asOfDate: jobBuildDate(job.data)
          });
        });
        break;
      }
      case "itemToQuoteLine": {
        const [quoteId = "", quoteLineId = ""] = (targetId as string).split(
          ":"
        );
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;

        const [
          makeMethod,
          quoteMakeMethod,
          workCenters,
          supplierProcesses,
          configurationRules,
          quote,
          ownedQuoteLine
        ] = await inOrder([
          () => single(db, "activeMakeMethods", { itemId, companyId }),
          () =>
            maybeSingle(db, "quoteMakeMethod", {
              quoteLineId,
              parentMaterialId: isNull,
              companyId
            }),
          () => many(db, "workCenters", { companyId }),
          () => many(db, "supplierProcess", { companyId }),
          () =>
            isConfigured
              ? many(db, "configurationRule", { itemId, companyId })
              : Promise.resolve({ data: null, error: null }),
          () => single(db, "quote", { id: quoteId, companyId }),
          () =>
            maybeSingle(db, "quoteLine", {
              id: quoteLineId,
              quoteId,
              companyId
            })
        ]);

        // The permission check proved the CALLER may act in companyId; it proves
        // nothing about the quote line in the body. The quoteMakeMethod lookup
        // is scoped, but a miss INSERTS one and then rewrites the line's
        // materials and operations by quoteLineId alone.
        if (ownedQuoteLine.error) {
          throw new Error("Failed to get quote line");
        }
        if (!ownedQuoteLine.data) {
          throw new NotFoundError("Quote line not found");
        }

        const configurationCodeByField = configurationRules?.data?.reduce<
          Record<string, string>
        >((acc, rule) => {
          acc[rule.field] = rule.code;
          return acc;
        }, {});

        const quoteLocationId = quote.data?.locationId;

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        if (!quoteMakeMethod.data) {
          await db
            .insertInto("quoteMakeMethod")
            .values({
              quoteId,
              quoteLineId,
              itemId,
              companyId,
              createdBy: userId
            })
            .execute();
          // Read back in the shape the rest of this flow uses.
          const inserted = await single(db, "quoteMakeMethod", {
            quoteLineId,
            parentMaterialId: isNull,
            companyId
          });

          if (inserted.error || !inserted.data) {
            throw new Error("Failed to create quote make method");
          }
          quoteMakeMethod.data = inserted.data;
        }

        if (workCenters.error) {
          throw new Error("Failed to get related work centers");
        }

        const hydratedConfiguration = await hydrateConfiguration(
          db,
          configuration,
          itemId,
          companyId
        );

        const [methodTrees] = await inOrder([
          () => getMethodTree(db, makeMethod.data.id!)
        ]);

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new NotFoundError("Method tree not found");

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

        await db
          .transaction()
          .execute(async (trx: Transaction<KyselyDatabase>) => {
            if (isConfigured) {
              await trx
                .updateTable("quoteLine")
                .set({
                  configuration: JSON.stringify(configuration),
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                })
                .where("id", "=", quoteLineId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // Delete existing quoteMakeMethod, quoteMakeMethodOperation, quoteMakeMethodMaterial
            await Promise.all([
              parts.billOfMaterial
                ? trx
                    .deleteFrom("quoteMakeMethod")
                    .where((eb) =>
                      eb.and([
                        eb("quoteLineId", "=", quoteLineId),
                        eb("parentMaterialId", "is not", null)
                      ])
                    )
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              parts.billOfMaterial
                ? trx
                    .deleteFrom("quoteMaterial")
                    .where("quoteLineId", "=", quoteLineId)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              // Prevent cascade deletion of materials when only replacing operations
              !parts.billOfMaterial && parts.billOfProcess
                ? trx
                    .updateTable("quoteMaterial")
                    .set({ quoteOperationId: null })
                    .where("quoteLineId", "=", quoteLineId)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              parts.billOfProcess
                ? trx
                    .deleteFrom("quoteOperation")
                    .where("quoteLineId", "=", quoteLineId)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              trx
                .updateTable("quoteMakeMethod")
                .set({ version: makeMethod.data.version ?? 1 })
                .where("id", "=", quoteMakeMethod.data!.id!)
                .where("companyId", "=", companyId)
                .execute()
            ]);

            async function getConfiguredValue<
              T extends number | string | boolean | null
            >({
              id,
              field,
              defaultValue
            }: {
              id: string;
              field: string;
              defaultValue: T;
            }): Promise<T> {
              if (!configurationCodeByField) return defaultValue;

              const fieldKey = getFieldKey(field, id);

              if (configurationCodeByField[fieldKey]) {
                try {
                  const code = configurationCodeByField[fieldKey];
                  const mod = await importTypeScript(code);
                  const result = await mod.configure(hydratedConfiguration);

                  return (result ?? defaultValue) as T;
                } catch (err) {
                  logger.error("configuration field resolver failed", {
                    error: String((err as Error)?.stack ?? err)
                  });
                  return defaultValue;
                }
              }

              return defaultValue;
            }

            // traverse method tree and create:
            // - quoteMakeMethod
            // - quoteMakeMethodOperation
            // - quoteMakeMethodMaterial
            async function traverseMethod(
              node: MethodTreeItem,
              parentQuoteMakeMethodId: string | null
            ) {
              logger.debug("[traverseMethod]", {
                isRoot: node.data.isRoot,
                itemId: node.data.itemId,
                methodType: node.data.methodType,
                materialMakeMethodId: node.data.materialMakeMethodId,
                childCount: node.children.length,
                childMethodTypes: node.children.map((c) => ({
                  itemId: c.data.itemId,
                  methodType: c.data.methodType
                })),
                parentQuoteMakeMethodId
              });

              let methodOperationsToQuoteOperations: Record<string, string> =
                {};

              const nodeLevelConfigurationKey = `${
                node.data.materialMakeMethodId
              }:${node.data.isRoot ? "undefined" : node.data.methodMaterialId}`;

              // For child nodes, always include operations regardless of parts flags
              if (!node.data.isRoot || parts.billOfProcess) {
                const relatedOperations = {
                  data: treeOperations.get(node.data.materialMakeMethodId) ?? []
                };

                let quoteOperationsInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
                  [];
                // Index-aligned with quoteOperationsInserts, as in itemToJob:
                // a blank configured processId skips a row and a billOfProcess
                // configuration reorders and filters them, so the returned ids
                // cannot be paired against relatedOperations.data.
                let sourceOperations: typeof relatedOperations.data = [];
                for await (const op of relatedOperations?.data ?? []) {
                  const [
                    processId,
                    procedureId,
                    workCenterId,
                    description,
                    setupTime,
                    setupUnit,
                    laborTime,
                    laborUnit,
                    machineTime,
                    machineUnit,
                    operationOrder,
                    operationType
                  ] = await Promise.all([
                    getConfiguredValue({
                      id: op.id,
                      field: "processId",
                      defaultValue: op.processId
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "procedureId",
                      defaultValue: op.procedureId
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "workCenterId",
                      defaultValue: op.workCenterId
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "description",
                      defaultValue: op.description
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "setupTime",
                      defaultValue: op.setupTime
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "setupUnit",
                      defaultValue: op.setupUnit
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "laborTime",
                      defaultValue: op.laborTime
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "laborUnit",
                      defaultValue: op.laborUnit
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "machineTime",
                      defaultValue: op.machineTime
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "machineUnit",
                      defaultValue: op.machineUnit
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "operationOrder",
                      defaultValue: op.operationOrder
                    }),
                    getConfiguredValue({
                      id: op.id,
                      field: "operationType",
                      defaultValue: op.operationType
                    })
                  ]);

                  if (processId === "") continue;

                  const operationRates = getLaborAndOverheadRates(
                    processId,
                    op.workCenterId
                  );
                  logger.debug("traverseMethod", {
                    processId,
                    ...operationRates
                  });

                  sourceOperations.push(op);
                  quoteOperationsInserts.push({
                    quoteId,
                    quoteLineId,
                    quoteMakeMethodId: parentQuoteMakeMethodId!,
                    processId,
                    procedureId,
                    assemblyInstructionId: op.assemblyInstructionId,
                    inspectionDocumentId: op.inspectionDocumentId,
                    workCenterId,
                    description,
                    setupTime,
                    setupUnit,
                    laborTime,
                    laborUnit,
                    machineTime,
                    machineUnit,
                    ...getLaborAndOverheadRates(processId, op.workCenterId),
                    order: op.order,
                    operationOrder,
                    operationType: normalizeOperationType(operationType),
                    operationSupplierProcessId: op.operationSupplierProcessId,
                    operationUnitCost: op.operationUnitCost ?? 0,
                    ...getOutsideOperationRates(
                      processId,
                      op.operationSupplierProcessId
                    ),
                    operationMinimumCost: op.operationMinimumCost ?? 0,
                    tags: op.tags ?? [],
                    workInstruction: toJson(
                      !node.data.isRoot || parts.workInstructions
                        ? op.workInstruction
                        : {}
                    ),
                    companyId,
                    createdBy: userId,
                    customFields: {}
                  });
                }

                const bopConfigurationKey = `billOfProcess:${nodeLevelConfigurationKey}`;
                let bopConfiguration: string[] | null = null;

                if (configurationCodeByField?.[bopConfigurationKey]) {
                  const mod = await importTypeScript(
                    configurationCodeByField[bopConfigurationKey]
                  );
                  bopConfiguration = await mod.configure(hydratedConfiguration);
                }

                if (bopConfiguration) {
                  const configuredInserts: typeof quoteOperationsInserts = [];
                  const configuredSources: typeof sourceOperations = [];
                  bopConfiguration.forEach((description, index) => {
                    const position = quoteOperationsInserts.findIndex(
                      (operation) => operation.description === description
                    );
                    if (position !== -1) {
                      configuredInserts.push({
                        ...quoteOperationsInserts[position]!,
                        order: index + 1
                      });
                      configuredSources.push(sourceOperations[position]!);
                    }
                  });
                  quoteOperationsInserts = configuredInserts;
                  sourceOperations = configuredSources;
                }

                if (quoteOperationsInserts?.length > 0) {
                  const operationIds = await trx
                    .insertInto("quoteOperation")
                    .values(quoteOperationsInserts)
                    .returning(["id"])
                    .execute();

                  for (const [index, operation] of sourceOperations.entries()) {
                    const operationId = operationIds[index]?.id;

                    if (operationId) {
                      const {
                        methodOperationTool,
                        methodOperationParameter,
                        methodOperationStep,
                        procedureId
                      } = operation;

                      if (
                        (!node.data.isRoot || parts.tools) &&
                        Array.isArray(methodOperationTool) &&
                        methodOperationTool.length > 0
                      ) {
                        await trx
                          .insertInto("quoteOperationTool")
                          .values(
                            methodOperationTool.map((tool) => ({
                              toolId: tool.toolId,
                              quantity: tool.quantity,
                              operationId,
                              companyId,
                              createdBy: userId
                            }))
                          )
                          .execute();
                      }

                      if (!procedureId) {
                        if (
                          (!node.data.isRoot || parts.parameters) &&
                          Array.isArray(methodOperationParameter) &&
                          methodOperationParameter.length > 0
                        ) {
                          const parameters = await Promise.all(
                            methodOperationParameter.map(async (param) => ({
                              operationId,
                              key: param.key,
                              value: await getConfiguredValue({
                                id: operation.id,
                                field: `parameter:${param.id}:value`,
                                defaultValue: param.value
                              }),
                              companyId,
                              createdBy: userId
                            }))
                          );

                          await trx
                            .insertInto("quoteOperationParameter")
                            .values(parameters)
                            .execute();
                        }

                        if (
                          (!node.data.isRoot || parts.steps) &&
                          Array.isArray(methodOperationStep) &&
                          methodOperationStep.length > 0
                        ) {
                          const attributes = await Promise.all(
                            methodOperationStep.map(
                              async ({
                                id,
                                // quoteOperationStep has no provenance marker
                                assemblyInstructionStepId:
                                  _assemblyInstructionStepId,
                                ...attribute
                              }) => ({
                                ...attribute,
                                description: toTiptapDoc(attribute.description),
                                operationId,
                                minValue: await getConfiguredValue({
                                  id: operation.id,
                                  field: `attribute:${id}:minValue`,
                                  defaultValue: attribute.minValue
                                }),
                                maxValue: await getConfiguredValue({
                                  id: operation.id,
                                  field: `attribute:${id}:maxValue`,
                                  defaultValue: attribute.maxValue
                                }),
                                companyId,
                                createdBy: userId
                              })
                            )
                          );

                          const insertedSteps = await trx
                            .insertInto("quoteOperationStep")
                            .values(attributes)
                            .returning(["id"])
                            .execute();

                          await copyStepSlides(
                            trx,
                            methodOperationStep,
                            insertedSteps,
                            "methodOperationStepSlide",
                            "quoteOperationStepSlide",
                            companyId,
                            userId
                          );
                        }
                      }
                    }
                  }

                  methodOperationsToQuoteOperations = sourceOperations.reduce<
                    Record<string, string>
                  >((acc, op, index) => {
                    const operationId = operationIds[index]?.id;
                    if (operationId) {
                      acc[op.id!] = operationId;
                    }
                    return acc;
                  }, {});
                }
              } // end if (parts.billOfProcess)

              if (parts.billOfMaterial) {
                const mapMethodMaterialToQuoteMaterial = async (
                  child: MethodTreeItem
                ) => {
                  let [
                    itemId,
                    description,
                    quantity,
                    methodType,
                    unitOfMeasureCode
                  ] = await Promise.all([
                    getConfiguredValue({
                      id: child.data.methodMaterialId,
                      field: "itemId",
                      defaultValue: child.data.itemId
                    }),
                    getConfiguredValue({
                      id: child.data.methodMaterialId,
                      field: "description",
                      defaultValue: child.data.description
                    }),
                    getConfiguredValue({
                      id: child.data.methodMaterialId,
                      field: "quantity",
                      defaultValue: child.data.quantity
                    }),
                    getConfiguredValue({
                      id: child.data.methodMaterialId,
                      field: "methodType",
                      defaultValue: child.data.methodType
                    }),
                    getConfiguredValue({
                      id: child.data.methodMaterialId,
                      field: "unitOfMeasureCode",
                      defaultValue: child.data.unitOfMeasureCode
                    })
                  ]);

                  if (itemId === "") return null;
                  // A configured (or authored) quantity of 0 removes the line from
                  // the BOM (and its sub-tree, via configuredChildren below).
                  if (isZeroQuantity(quantity)) return null;

                  let itemType = child.data.itemType;
                  let unitCost = child.data.unitCost;

                  // TODO: if the methodType is Make and the default value is not Make, we need to do itemToQuoteMakeMethod for that material

                  if (itemId !== child.data.itemId) {
                    const item = await single<
                      "item",
                      Tables["item"]["Row"] & {
                        itemCost: Tables["itemCost"]["Row"][];
                      }
                    >(
                      trx,
                      "item",
                      { id: itemId, companyId },
                      {
                        embed: { itemCost: { table: "itemCost", on: "itemId" } }
                      }
                    );
                    if (item.data) {
                      itemType = item.data.type;
                      unitCost =
                        item.data.itemCost[0]?.unitCost ?? child.data.unitCost;
                      if (description === child.data.description) {
                        description = item.data.name;
                      }
                    } else {
                      itemId = child.data.itemId;
                    }
                  }

                  return {
                    quoteId,
                    quoteLineId,
                    quoteMakeMethodId: parentQuoteMakeMethodId!,
                    quoteOperationId:
                      methodOperationsToQuoteOperations[child.data.operationId],
                    order: child.data.order,
                    itemId,
                    itemType,
                    kit: child.data.kit,
                    methodType,
                    description,
                    quantity,
                    storageUnitId: quoteLocationId
                      ? // @ts-ignore: storageUnitIds is a dynamic object with location keys
                        (child.data.storageUnitIds?.[
                          quoteLocationId
                        ] as string) || null
                      : null,
                    unitOfMeasureCode,
                    unitCost: unitCost ?? 0,
                    companyId,
                    createdBy: userId,
                    customFields: {}
                  };
                };

                const quoteMaterialResults = await Promise.all(
                  node.children.map(mapMethodMaterialToQuoteMaterial)
                );
                const validQuoteMaterialIndices = quoteMaterialResults.reduce<
                  number[]
                >((acc, m, i) => {
                  if (m !== null) acc.push(i);
                  return acc;
                }, []);
                let materialsWithConfiguredFields = quoteMaterialResults.filter(
                  (m): m is NonNullable<typeof m> => m !== null
                );
                const configuredChildren = validQuoteMaterialIndices.map(
                  (i) => node.children[i]!
                );

                const bomConfigurationKey = `billOfMaterial:${nodeLevelConfigurationKey}`;
                let bomConfiguration: string[] | null = null;

                if (configurationCodeByField?.[bomConfigurationKey]) {
                  const mod = await importTypeScript(
                    configurationCodeByField[bomConfigurationKey]
                  );
                  bomConfiguration = await mod.configure(hydratedConfiguration);
                }

                if (bomConfiguration) {
                  // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
                  materialsWithConfiguredFields = bomConfiguration
                    .map((readableIdWithRevision, index) => {
                      const material = materialsWithConfiguredFields.find(
                        (material) => material.itemId === itemId
                      );
                      if (material) {
                        return {
                          ...material,
                          order: index + 1
                        };
                      }
                    })
                    .filter(Boolean);
                }

                const madeMaterials = materialsWithConfiguredFields.filter(
                  (material) => material.methodType === "Make to Order"
                );

                const pickedOrBoughtMaterials =
                  materialsWithConfiguredFields.filter(
                    (material) => material.methodType !== "Make to Order"
                  );

                const madeChildren = configuredChildren.filter(
                  (child) => child!.data.methodType === "Make to Order"
                );

                logger.debug("[traverseMethod] materials", {
                  totalChildren: materialsWithConfiguredFields.length,
                  madeMaterialsCount: madeMaterials.length,
                  madeChildrenCount: madeChildren.length,
                  pickedOrBoughtCount: pickedOrBoughtMaterials.length
                });

                if (madeMaterials.length > 0) {
                  const madeMaterialsWithIds = madeMaterials.map((m) => ({
                    ...m,
                    id: nanoid()
                  }));

                  await trx
                    .insertInto("quoteMaterial")
                    .values(madeMaterialsWithIds)
                    .execute();

                  const newMakeMethodIds = madeChildren.map(() => nanoid());
                  await renameMakeMethods(trx, {
                    table: "quoteMakeMethod",
                    companyId,
                    rows: madeChildren.map((_, index) => ({
                      parentMaterialId: madeMaterialsWithIds[index]!.id,
                      id: newMakeMethodIds[index]!
                    }))
                  });

                  for (const [index, child] of madeChildren.entries()) {
                    const materialId = madeMaterialsWithIds[index]!.id;
                    const newMakeMethodId = newMakeMethodIds[index]!;

                    logger.debug("[traverseMethod] processing made child", {
                      index,
                      materialId,
                      newMakeMethodId,
                      childItemId: child!.data.itemId,
                      parentItemId: itemId,
                      willRecurse: child!.data.itemId !== itemId
                    });

                    // prevent an infinite loop
                    if (child!.data.itemId !== itemId) {
                      await traverseMethod(child, newMakeMethodId);
                    }
                  }
                }

                deferredQuoteMaterials.push(...pickedOrBoughtMaterials);
              } // end if (parts.billOfMaterial)
            }

            function logTree(node: MethodTreeItem, depth = 0) {
              logger.debug(
                "  ".repeat(depth) +
                  `[tree] ${node.data.itemId} (${node.data.methodType}, isRoot=${node.data.isRoot}, children=${node.children.length})`
              );
              for (const child of node.children) {
                logTree(child, depth + 1);
              }
            }
            logTree(methodTree);

            const treeOperations = await readOperationsForTree(trx, methodTree);
            const deferredQuoteMaterials: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
              [];
            await traverseMethod(methodTree, quoteMakeMethod.data!.id);
            for (const chunk of chunked(deferredQuoteMaterials)) {
              await trx.insertInto("quoteMaterial").values(chunk).execute();
            }
          });

        await calculateQuoteLinePrices(
          db,
          quoteId,
          quoteLineId,
          companyId,
          userId
        );

        break;
      }
      case "itemToQuoteMakeMethod": {
        const quoteMakeMethodId = targetId;

        if (!quoteMakeMethodId) {
          throw new Error("Invalid targetId");
        }
        const itemId = sourceId;
        const isConfigured = !!configuration;

        const [makeMethod, quoteMakeMethod, workCenters, supplierProcesses] =
          await inOrder([
            () => single(db, "activeMakeMethods", { itemId, companyId }),
            () =>
              single(db, "quoteMakeMethod", {
                id: quoteMakeMethodId,
                companyId
              }),
            () => many(db, "workCenters", { companyId }),
            () => many(db, "supplierProcess", { companyId })
          ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error || !quoteMakeMethod.data) {
          throw new Error("Failed to get quote make method");
        }

        const hydratedConfiguration = await hydrateConfiguration(
          db,
          configuration,
          itemId,
          companyId
        );

        const [methodTrees, configurationRules] = await inOrder([
          () => getMethodTree(db, makeMethod.data.id!),
          () =>
            isConfigured
              ? many(db, "configurationRule", { itemId, companyId })
              : Promise.resolve({
                  data: [] as Tables["configurationRule"]["Row"][]
                })
        ]);

        if (methodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const methodTree = methodTrees.data?.[0] as MethodTreeItem;
        if (!methodTree) throw new NotFoundError("Method tree not found");

        const getLaborAndOverheadRates = getRatesFromWorkCenters(
          workCenters?.data
        );
        const getOutsideOperationRates = getRatesFromSupplierProcesses(
          supplierProcesses?.data
        );

        // Get configuration code by field
        const configurationCodeByField = configurationRules.data?.reduce<
          Record<string, string>
        >((acc, rule) => {
          acc[rule.field] = rule.code;
          return acc;
        }, {});

        await db.transaction().execute(async (trx) => {
          // Delete existing quoteMakeMethodOperation, quoteMakeMethodMaterial
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("quoteMaterial")
                  .where("quoteMakeMethodId", "=", quoteMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            // Prevent cascade deletion of materials when only replacing operations
            !parts.billOfMaterial && parts.billOfProcess
              ? trx
                  .updateTable("quoteMaterial")
                  .set({ quoteOperationId: null })
                  .where("quoteMakeMethodId", "=", quoteMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("quoteOperation")
                  .where("quoteMakeMethodId", "=", quoteMakeMethodId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            trx
              .updateTable("quoteMakeMethod")
              .set({ version: makeMethod.data.version ?? 1 })
              .where("id", "=", quoteMakeMethodId)
              .where("companyId", "=", companyId)
              .execute()
          ]);

          function getFieldKey(field: string, id: string) {
            return `${field}:${id}`;
          }

          // FIXME: never called — configuration rules are not applied on this
          // make-method path.
          // biome-ignore lint/correctness/noUnusedVariables: see FIXME above
          async function getConfiguredValue<T>({
            id,
            field,
            defaultValue
          }: {
            id: string;
            field: string;
            defaultValue: T;
          }): Promise<T> {
            if (!configurationCodeByField) return defaultValue;
            const fieldKey = getFieldKey(field, id);

            if (configurationCodeByField?.[fieldKey]) {
              try {
                const mod = await importTypeScript(
                  configurationCodeByField[fieldKey]
                );
                const result = await mod.configure(hydratedConfiguration);
                return (result ?? defaultValue) as T;
              } catch (err) {
                logger.error("configuration field resolver failed", {
                  error: String((err as Error)?.stack ?? err)
                });
                return defaultValue;
              }
            }

            return defaultValue;
          }

          // traverse method tree and create:
          // - quoteMakeMethod
          // - quoteMakeMethodOperation
          // - quoteMakeMethodMaterial
          async function traverseMethod(
            node: MethodTreeItem,
            parentQuoteMakeMethodId: string | null
          ) {
            const relatedOperations = {
              data: treeOperations.get(node.data.materialMakeMethodId) ?? []
            };

            const quoteOperationInserts =
              relatedOperations?.data?.map((op) => ({
                quoteId: quoteMakeMethod.data?.quoteId!,
                quoteLineId: quoteMakeMethod.data?.quoteLineId!,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId: op.processId,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                ...getLaborAndOverheadRates(op.processId, op.workCenterId),
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                operationUnitCost: op.operationUnitCost ?? 0,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  op.processId,
                  op.operationSupplierProcessId
                ),
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              })) ?? [];

            let methodOperationsToQuoteOperations: Record<string, string> = {};

            if (parts.billOfProcess) {
              if (quoteOperationInserts?.length > 0) {
                const operationIds = await trx
                  .insertInto("quoteOperation")
                  .values(quoteOperationInserts)
                  .returning(["id"])
                  .execute();

                for (const [index, operation] of (
                  relatedOperations.data ?? []
                ).entries()) {
                  const operationId = operationIds[index]!.id;

                  if (operationId) {
                    const {
                      methodOperationTool,
                      methodOperationParameter,
                      methodOperationStep,
                      procedureId
                    } = operation;

                    if (
                      parts.tools &&
                      Array.isArray(methodOperationTool) &&
                      methodOperationTool.length > 0
                    ) {
                      await trx
                        .insertInto("quoteOperationTool")
                        .values(
                          methodOperationTool.map((tool) => ({
                            toolId: tool.toolId,
                            quantity: tool.quantity,
                            operationId,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (!procedureId) {
                      if (
                        parts.parameters &&
                        Array.isArray(methodOperationParameter) &&
                        methodOperationParameter.length > 0
                      ) {
                        await trx
                          .insertInto("quoteOperationParameter")
                          .values(
                            methodOperationParameter.map((param) => ({
                              operationId,
                              key: param.key,
                              value: param.value,
                              companyId,
                              createdBy: userId
                            }))
                          )
                          .execute();
                      }

                      if (
                        parts.steps &&
                        // Assembly ops inherit steps from the linked instruction —
                        // never copy (possibly stale) template steps alongside it.
                        !operation.assemblyInstructionId &&
                        Array.isArray(methodOperationStep) &&
                        methodOperationStep.length > 0
                      ) {
                        const insertedSteps = await trx
                          .insertInto("quoteOperationStep")
                          .values(
                            methodOperationStep.map(
                              ({
                                id: _id,
                                // quoteOperationStep has no provenance marker
                                assemblyInstructionStepId:
                                  _assemblyInstructionStepId,
                                ...attribute
                              }) => ({
                                ...attribute,
                                description: toTiptapDoc(attribute.description),
                                operationId,
                                companyId,
                                createdBy: userId
                              })
                            )
                          )
                          .returning(["id"])
                          .execute();

                        await copyStepSlides(
                          trx,
                          methodOperationStep,
                          insertedSteps,
                          "methodOperationStepSlide",
                          "quoteOperationStepSlide",
                          companyId,
                          userId
                        );
                      }
                    }
                  }
                }

                methodOperationsToQuoteOperations =
                  relatedOperations.data?.reduce<Record<string, string>>(
                    (acc, op, index) => {
                      if (operationIds[index]!.id) {
                        acc[op.id!] = operationIds[index]!.id!;
                      }
                      return acc;
                    },
                    {}
                  ) ?? {};
              }
            } // end if (parts.billOfProcess)

            if (parts.billOfMaterial) {
              const mapMethodMaterialToQuoteMaterial = (
                child: MethodTreeItem
              ) => ({
                quoteId: quoteMakeMethod.data?.quoteId!,
                quoteLineId: quoteMakeMethod.data?.quoteLineId!,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                quoteOperationId:
                  methodOperationsToQuoteOperations[child.data.operationId],
                itemId: child.data.itemId,
                itemType: child.data.itemType,
                kit: child.data.kit,
                methodType: child.data.methodType,
                order: child.data.order,
                description: child.data.description,
                quantity: child.data.quantity,
                storageUnitId: (child.data as any).storageUnitId || null, // @ts-ignore: storageUnitId field exists in database but types may not be updated
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                unitCost: child.data.unitCost ?? 0,
                companyId,
                createdBy: userId,
                customFields: {}
              });

              // A zero-quantity BOM line is removed from the method. Filtering the
              // children (not the mapped rows) keeps `madeChildren`/`madeMaterials`
              // index-aligned and stops a made line's sub-tree from being exploded.
              const madeChildren = node.children.filter(
                (child) =>
                  child.data.methodType === "Make to Order" &&
                  !isZeroQuantity(child.data.quantity)
              );
              const unmadeChildren = node.children.filter(
                (child) =>
                  child.data.methodType !== "Make to Order" &&
                  !isZeroQuantity(child.data.quantity)
              );

              const madeMaterials = madeChildren.map(
                mapMethodMaterialToQuoteMaterial
              );
              const pickedOrBoughtMaterials = unmadeChildren.map(
                mapMethodMaterialToQuoteMaterial
              );
              if (madeMaterials.length > 0) {
                const madeMaterialsWithIds = madeMaterials.map((m) => ({
                  ...m,
                  id: nanoid()
                }));

                await trx
                  .insertInto("quoteMaterial")
                  .values(madeMaterialsWithIds)
                  .execute();

                const newMakeMethodIds = madeChildren.map(() => nanoid());
                await renameMakeMethods(trx, {
                  table: "quoteMakeMethod",
                  companyId,
                  rows: madeChildren.map((_, index) => ({
                    parentMaterialId: madeMaterialsWithIds[index]!.id,
                    id: newMakeMethodIds[index]!
                  }))
                });

                for (const [index, child] of madeChildren.entries()) {
                  const newMakeMethodId = newMakeMethodIds[index]!;

                  // prevent an infinite loop
                  if (child.data.itemId !== itemId) {
                    await traverseMethod(child, newMakeMethodId);
                  }
                }
              }

              deferredQuoteMaterials.push(...pickedOrBoughtMaterials);
            } // end if (parts.billOfMaterial)
          }

          const treeOperations = await readOperationsForTree(trx, methodTree);
          const deferredQuoteMaterials: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
            [];
          await traverseMethod(methodTree, quoteMakeMethod.data.id);
          for (const chunk of chunked(deferredQuoteMaterials)) {
            await trx.insertInto("quoteMaterial").values(chunk).execute();
          }
        });
        break;
      }
      case "jobMakeMethodToItem": {
        const jobMakeMethodId = sourceId;
        const makeMethodId = targetId;

        const [makeMethod, jobMakeMethod] = await inOrder([
          () => single(db, "makeMethod", { id: makeMethodId, companyId }),
          () => single(db, "jobMakeMethod", { id: jobMakeMethodId, companyId })
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error) {
          throw new Error("Failed to get job make method");
        }

        const itemId = makeMethod.data?.itemId;

        const [job, jobOperations, itemReplenishment] = await inOrder([
          () => single(db, "job", { id: jobMakeMethod.data.jobId, companyId }),
          () =>
            many<
              "jobOperationsWithMakeMethods",
              Views["jobOperationsWithMakeMethods"]["Row"] & {
                jobOperationTool: Tables["jobOperationTool"]["Row"][];
                jobOperationParameter: Tables["jobOperationParameter"]["Row"][];
                jobOperationStep: Tables["jobOperationStep"]["Row"][];
              }
            >(
              db,
              "jobOperationsWithMakeMethods",
              { jobId: jobMakeMethod.data.jobId, companyId },
              {
                embed: {
                  jobOperationTool: {
                    table: "jobOperationTool",
                    on: "operationId"
                  },
                  jobOperationParameter: {
                    table: "jobOperationParameter",
                    on: "operationId"
                  },
                  jobOperationStep: {
                    table: "jobOperationStep",
                    on: "operationId"
                  }
                }
              }
            ),
          () => single(db, "itemReplenishment", { itemId, companyId })
        ]);

        if (jobOperations.error) {
          throw new Error("Failed to get job operations");
        }

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

        const [jobMethodTrees] = await inOrder([
          () =>
            getJobMethodTree(
              db,
              jobMakeMethodId,
              jobMakeMethod.data.parentMaterialId
            )
        ]);

        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree)
          throw new NotFoundError("Job method tree not found");

        const madeItemIds: string[] = [];

        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make to Order") {
            madeItemIds.push(node.data.itemId);
          }
        });

        const makeMethods = await many(db, "makeMethod", {
          itemId: madeItemIds
        });
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          makeMethodByItemId[m.itemId] = m.id;
        });

        await db.transaction().execute(async (trx) => {
          let makeMethodsToDelete: string[] = [];
          const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
            [];
          const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
            [];

          traverseJobMethod(jobMethodTree!, (node: JobMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make to Order") {
              makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
            }

            node.children.forEach((child) => {
              // A zero-quantity BOM line is dropped from the saved method.
              if (isZeroQuantity(child.data.quantity)) return;
              materialInserts.push({
                makeMethodId: makeMethodByItemId[node.data.itemId]!,
                materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                itemId: child.data.itemId,
                itemType: child.data.itemType,
                kit: child.data.kit,
                methodType: child.data.methodType,
                order: child.data.order,
                quantity: child.data.quantity,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                storageUnitIds: job.data?.locationId
                  ? {
                      [job.data.locationId]: child.data.storageUnitId || null
                    }
                  : {},
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });
          });

          if (makeMethodsToDelete.length > 0) {
            makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
              mm === makeMethodByItemId[jobMakeMethod.data.itemId]
                ? makeMethod.data.id
                : mm
            );
            await Promise.all([
              parts.billOfMaterial
                ? trx
                    .deleteFrom("methodMaterial")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              parts.billOfProcess
                ? trx
                    .deleteFrom("methodOperation")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve()
            ]);
          }

          if (parts.billOfMaterial && materialInserts.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialInserts.map((insert) => ({
                  ...insert,
                  productionQuantity: undefined,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === jobMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId
                }))
              )
              .execute();
          }

          if (parts.billOfProcess) {
            jobOperations.data?.forEach((op) => {
              operationInserts.push({
                makeMethodId: op.makeMethodId!,
                processId: op.processId!,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId: op.workCenterId,
                description: op.description ?? "",
                setupTime: op.setupTime ?? 0,
                setupUnit: op.setupUnit ?? "Total Minutes",
                laborTime: op.laborTime ?? 0,
                laborUnit: op.laborUnit ?? "Minutes/Piece",
                machineTime: op.machineTime ?? 0,
                machineUnit: op.machineUnit ?? "Minutes/Piece",
                order: op.order ?? 1,
                operationOrder: op.operationOrder ?? "After Previous",
                operationType: op.operationType ?? "Process",
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });

            if (operationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("methodOperation")
                .values(
                  operationInserts.map((insert) => ({
                    ...insert,
                    makeMethodId:
                      insert.makeMethodId ===
                      makeMethodByItemId[jobMakeMethod.data.itemId]
                        ? makeMethod.data.id
                        : insert.makeMethodId
                  }))
                )
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                jobOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    jobOperationTool,
                    jobOperationParameter,
                    jobOperationStep,
                    procedureId
                  } = operation;

                  if (
                    parts.tools &&
                    Array.isArray(jobOperationTool) &&
                    jobOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationTool")
                      .values(
                        jobOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (!procedureId) {
                    if (
                      parts.parameters &&
                      Array.isArray(jobOperationParameter) &&
                      jobOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("methodOperationParameter")
                        .values(
                          jobOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (
                      parts.steps &&
                      // Assembly ops and inspection ops inherit their steps from
                      // the linked instruction/document — never copy materialized
                      // steps back onto a template.
                      !operation.assemblyInstructionId &&
                      !operation.inspectionDocumentId &&
                      Array.isArray(jobOperationStep) &&
                      jobOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("jobOperationStep")
                        .values(
                          jobOperationStep.map(({ id: _id, ...attribute }) => ({
                            ...attribute,
                            description: toTiptapDoc(attribute.description),
                            operationId,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        jobOperationStep,
                        insertedSteps,
                        "jobOperationStepSlide",
                        "jobOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)
        });

        break;
      }
      case "jobToItem": {
        const jobId = sourceId;
        if (!jobId) {
          throw new Error("Invalid sourceId");
        }
        const makeMethodId = targetId;

        const [makeMethod, jobMakeMethod, jobOperations, job] = await inOrder([
          () => single(db, "makeMethod", { id: makeMethodId, companyId }),
          () =>
            single(db, "jobMakeMethod", {
              jobId,
              parentMaterialId: isNull,
              companyId
            }),
          () =>
            many<
              "jobOperationsWithMakeMethods",
              Views["jobOperationsWithMakeMethods"]["Row"] & {
                jobOperationTool: Tables["jobOperationTool"]["Row"][];
                jobOperationParameter: Tables["jobOperationParameter"]["Row"][];
                jobOperationStep: Tables["jobOperationStep"]["Row"][];
              }
            >(
              db,
              "jobOperationsWithMakeMethods",
              { jobId, companyId },
              {
                embed: {
                  jobOperationTool: {
                    table: "jobOperationTool",
                    on: "operationId"
                  },
                  jobOperationParameter: {
                    table: "jobOperationParameter",
                    on: "operationId"
                  },
                  jobOperationStep: {
                    table: "jobOperationStep",
                    on: "operationId"
                  }
                }
              }
            ),
          () => single(db, "job", { id: jobId, companyId })
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (jobMakeMethod.error) {
          throw new Error("Failed to get job make method");
        }

        if (jobOperations.error) {
          throw new Error("Failed to get job operations");
        }

        const itemId = makeMethod.data?.itemId;

        const [jobMethodTrees, itemReplenishment] = await inOrder([
          () => getJobMethodTree(db, jobMakeMethod.data.id),
          () => single(db, "itemReplenishment", { itemId, companyId })
        ]);

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) throw new NotFoundError("Method tree not found");

        const madeItemIds: string[] = [];

        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make to Order") {
            madeItemIds.push(node.data.itemId);
          }
        });

        const makeMethods = await many(db, "activeMakeMethods", {
          itemId: madeItemIds,
          companyId
        });
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          if (m.itemId) {
            // @ts-expect-error - itemId is not null
            makeMethodByItemId[m.itemId!] = m.id;
          }
        });

        await db.transaction().execute(async (trx) => {
          let makeMethodsToDelete: string[] = [];
          const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
            [];
          const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
            [];

          traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make to Order") {
              makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
            }

            node.children.forEach((child) => {
              // A zero-quantity BOM line is dropped from the saved method.
              if (isZeroQuantity(child.data.quantity)) return;
              materialInserts.push({
                makeMethodId: makeMethodByItemId[node.data.itemId]!,
                materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                itemId: child.data.itemId,
                itemType: child.data.itemType,
                kit: child.data.kit,
                methodType: child.data.methodType,
                order: child.data.order,
                quantity: child.data.quantity,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                storageUnitIds: job.data?.locationId
                  ? {
                      [job.data.locationId]: child.data.storageUnitId || null
                    }
                  : {},
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });
          });

          if (makeMethodsToDelete.length > 0) {
            makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
              mm === makeMethodByItemId[jobMakeMethod.data.itemId]
                ? makeMethod.data.id
                : mm
            );
            await Promise.all([
              parts.billOfMaterial
                ? trx
                    .deleteFrom("methodMaterial")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              parts.billOfProcess
                ? trx
                    .deleteFrom("methodOperation")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve()
            ]);
          }

          if (parts.billOfMaterial && materialInserts.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialInserts.map((insert) => ({
                  ...insert,
                  productionQuantity: undefined,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === jobMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId
                }))
              )
              .execute();
          }

          if (parts.billOfProcess) {
            jobOperations.data?.forEach((op) => {
              operationInserts.push({
                makeMethodId: op.makeMethodId!,
                processId: op.processId!,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                // workCenterId: op.workCenterId,
                description: op.description ?? "",
                setupTime: op.setupTime ?? 0,
                setupUnit: op.setupUnit ?? "Total Minutes",
                laborTime: op.laborTime ?? 0,
                laborUnit: op.laborUnit ?? "Minutes/Piece",
                machineTime: op.machineTime ?? 0,
                machineUnit: op.machineUnit ?? "Minutes/Piece",
                order: op.order ?? 1,
                operationOrder: op.operationOrder ?? "After Previous",
                operationType: op.operationType ?? "Process",
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                operationSupplierProcessId: op.operationSupplierProcessId,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });

            if (operationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("methodOperation")
                .values(
                  operationInserts.map((insert) => ({
                    ...insert,
                    makeMethodId:
                      insert.makeMethodId ===
                      makeMethodByItemId[jobMakeMethod.data.itemId]
                        ? makeMethod.data.id
                        : insert.makeMethodId
                  }))
                )
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                jobOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    jobOperationTool,
                    jobOperationParameter,
                    jobOperationStep,
                    procedureId
                  } = operation;

                  if (
                    parts.tools &&
                    Array.isArray(jobOperationTool) &&
                    jobOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationTool")
                      .values(
                        jobOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (!procedureId) {
                    if (
                      parts.parameters &&
                      Array.isArray(jobOperationParameter) &&
                      jobOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("methodOperationParameter")
                        .values(
                          jobOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (
                      parts.steps &&
                      // Assembly ops and inspection ops inherit their steps from
                      // the linked instruction/document — never copy materialized
                      // steps back onto a template.
                      !operation.assemblyInstructionId &&
                      !operation.inspectionDocumentId &&
                      Array.isArray(jobOperationStep) &&
                      jobOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("methodOperationStep")
                        .values(
                          jobOperationStep.map((step) => ({
                            operationId,
                            name: step.name,
                            type: step.type,
                            description: toTiptapDoc(step.description),
                            required: step.required,
                            sortOrder: step.sortOrder,
                            unitOfMeasureCode: step.unitOfMeasureCode,
                            minValue: step.minValue,
                            maxValue: step.maxValue,
                            listValues: step.listValues,
                            fileTypes: step.fileTypes,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        jobOperationStep,
                        insertedSteps,
                        "jobOperationStepSlide",
                        "methodOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)
        });

        break;
      }
      case "jobToJob": {
        const sourceJobId = sourceId;
        const targetJobId = targetId;
        if (!sourceJobId || !targetJobId) {
          throw new Error("Invalid sourceId or targetId");
        }
        if (sourceJobId === targetJobId) {
          throw new Error("Cannot copy a job method onto itself");
        }

        // Assembly ops whose steps were materialized from an instruction —
        // material ↔ step links flush after the jobMaterial rows exist.
        const assemblyOperationsToLink: Array<{
          operationId: string;
          assemblyInstructionId: string;
        }> = [];

        // The embeds defeat the generated response types (as elsewhere in this
        // file), so the paged rows are typed explicitly.
        type SourceJobMaterialRow =
          Database["public"]["Tables"]["jobMaterial"]["Row"] & {
            jobMaterialStep: {
              jobOperationStepId: string | null;
              quantity: number | null;
            }[];
          };
        type SourceJobOperationRow =
          Database["public"]["Tables"]["jobOperation"]["Row"] & {
            jobOperationTool: (Database["public"]["Tables"]["jobOperationTool"]["Row"] & {
              jobOperationToolStep: { jobOperationStepId: string | null }[];
            })[];
            jobOperationParameter: Database["public"]["Tables"]["jobOperationParameter"]["Row"][];
            jobOperationStep: Database["public"]["Tables"]["jobOperationStep"]["Row"][];
          };

        // Paged: a bare select stops at PostgREST's 1000-row cap and would
        // silently copy a subset of a large job. The secondary `.order("id")`
        // makes paging stable across batches. Started here (not awaited) so the
        // reads below run concurrently with them.
        const targetJob = await single(db, "job", {
          id: targetJobId,
          companyId
        });
        const sourceJob = await single(db, "job", {
          id: sourceJobId,
          companyId
        });
        const targetJobMakeMethod = await single(db, "jobMakeMethod", {
          jobId: targetJobId,
          parentMaterialId: isNull,
          companyId
        });
        const sourceJobMakeMethod = await single(db, "jobMakeMethod", {
          jobId: sourceJobId,
          parentMaterialId: isNull,
          companyId
        });
        const sourceMaterials = await many<"jobMaterial", SourceJobMaterialRow>(
          db,
          "jobMaterial",
          { jobId: sourceJobId, companyId },
          {
            orderBy: ["id"],
            embed: {
              jobMaterialStep: { table: "jobMaterialStep", on: "jobMaterialId" }
            }
          }
        );
        const sourceOperations = await many<
          "jobOperation",
          SourceJobOperationRow
        >(
          db,
          "jobOperation",
          { jobId: sourceJobId, companyId },
          {
            orderBy: ["order", "id"],
            embed: {
              jobOperationTool: {
                table: "jobOperationTool",
                on: "operationId",
                embed: {
                  jobOperationToolStep: {
                    table: "jobOperationToolStep",
                    on: "jobOperationToolId"
                  }
                }
              },
              jobOperationParameter: {
                table: "jobOperationParameter",
                on: "operationId"
              },
              jobOperationStep: { table: "jobOperationStep", on: "operationId" }
            }
          }
        );

        if (targetJob.error) {
          throw new Error("Failed to get job");
        }
        if (sourceJob.error) {
          throw new Error("Failed to get source job");
        }
        if (targetJobMakeMethod.error || !targetJobMakeMethod.data) {
          throw new Error("Failed to get job make method");
        }
        if (sourceJobMakeMethod.error || !sourceJobMakeMethod.data) {
          throw new Error("Failed to get source job make method");
        }
        if (sourceMaterials.error) {
          throw new Error("Failed to get source job materials");
        }
        if (sourceOperations.error) {
          throw new Error("Failed to get source job operations");
        }

        const jobMethodTrees = await getJobMethodTree(
          db,
          sourceJobMakeMethod.data.id
        );
        if (jobMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }
        const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
        if (!jobMethodTree) throw new NotFoundError("Method tree not found");

        // A process-only copy of a multi-level job cannot work: the sub-assembly
        // make methods only come into existence on the bill-of-material path, so
        // their operations would reference make methods that were never created
        // (jobOperation_jobMakeMethodId_fkey). Refuse with an authored message
        // instead of rolling back on the FK.
        if (!parts.billOfMaterial && parts.billOfProcess) {
          let hasSubAssemblies = false;
          traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
            for (const child of node.children) {
              if (child.data.jobMaterialMakeMethodId) {
                hasSubAssemblies = true;
              }
            }
          });
          if (hasSubAssemblies) {
            throw new Error(
              "Copying only the bill of process from a job with sub-assemblies is not supported — include the bill of material as well"
            );
          }
        }

        // Loaded ONCE per request, before the transaction — as every *-ToJob
        // path does. The source job's rows were swapped live at ITS creation;
        // this re-resolves as-of the TARGET job's build date, so a supersession
        // that became effective since then still redirects the copy.
        const { redirect: supersessionRedirect } =
          await loadSupersessionRedirect(db, companyId, targetJob.data);
        const itemDefaults = createItemDefaults(
          companyId,
          targetJob.data.locationId
        );

        let selfConsumedItem: string | null = null;
        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
          for (const child of node.children) {
            const resolvedItemId =
              child.data.methodType !== "Make to Order"
                ? (supersessionRedirect.get(child.data.itemId)?.to ??
                  child.data.itemId)
                : child.data.itemId;
            if (resolvedItemId === targetJob.data.itemId) {
              selfConsumedItem = child.data.itemReadableId ?? resolvedItemId;
            }
          }
        });
        if (selfConsumedItem) {
          throw new Error(
            `The source job's method consumes ${selfConsumedItem}, which is the item this job produces — a job cannot consume its own output`
          );
        }

        const sourceMaterialRows = sourceMaterials.data ?? [];
        const sourceOperationRows = sourceOperations.data ?? [];

        const sourceMaterialById = new Map(
          sourceMaterialRows.map((m) => [m.id, m])
        );

        const sourceMaterialIdToJobMaterialId: Record<string, string> = {};
        const sourceMakeMethodIdToJobMakeMethodId: Record<string, string> = {};
        // Track estimated quantities for each SOURCE make method to set on operations
        const sourceMakeMethodIdToQuantities: Record<
          string,
          {
            targetQuantity: number;
            estimatedQuantity: number;
            totalWithScrap: number;
          }
        > = {};
        // Old job step id -> new job step id, for material/tool ↔ step links.
        const sourceStepsToJobSteps: Record<string, string> = {};
        const sourceOperationIdToJobOperationId: Record<string, string> = {};

        await db.transaction().execute(async (trx) => {
          await itemDefaults.load(
            trx,
            treeItemIds(jobMethodTree, supersessionRedirect)
          );
          // Delete existing jobMakeMethods, jobMaterials, and jobOperations for the target job
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMakeMethod")
                  .where((eb) =>
                    eb.and([
                      eb("jobId", "=", targetJobId),
                      eb("parentMaterialId", "is not", null)
                    ])
                  )
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMaterial")
                  .where("jobId", "=", targetJobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            // Prevent cascade deletion of materials when only replacing operations
            !parts.billOfMaterial && parts.billOfProcess
              ? trx
                  .updateTable("jobMaterial")
                  .set({ jobOperationId: null })
                  .where("jobId", "=", targetJobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("jobOperation")
                  .where("jobId", "=", targetJobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);

          const insertedJobMaterialIds: string[] = [];
          await traverseJobMethodAsync(
            jobMethodTree,
            async (node: JobMethodTreeItem) => {
              const jobMaterialInserts: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
                [];
              const jobMakeMethodInserts: Database["public"]["Tables"]["jobMakeMethod"]["Insert"][] =
                [];

              // Get the total quantity for this node (parent level) to pass to children
              // This is estimated + scrap for Make parts (what children use for their target calculation)
              let nodeTotalForChildren: number;
              if (node.data.isRoot) {
                // Root: target = TARGET job quantity — the source job's own
                // quantity is irrelevant; the tree carries per-parent quantities.
                const rootScrapPercentage = await itemDefaults.scrapPercentage(
                  trx,
                  node.data.itemId
                );
                const rootTarget = targetJob.data?.quantity ?? 1;
                // Scrap applies to every method type (mirrors itemToJob)
                const rootScrapQuantity = scrapAllowance(
                  rootTarget,
                  rootScrapPercentage
                );
                const rootTotalWithScrap = rootTarget + rootScrapQuantity;
                const rootEstimatedQuantity =
                  node.data.methodType === "Make to Order"
                    ? rootTarget
                    : rootTotalWithScrap;

                nodeTotalForChildren = rootTotalWithScrap;

                sourceMakeMethodIdToQuantities[sourceJobMakeMethod.data.id] = {
                  targetQuantity: rootTarget,
                  estimatedQuantity: rootEstimatedQuantity,
                  totalWithScrap: rootTotalWithScrap
                };
              } else {
                // Non-root: get from stored quantities using parent's source jobMakeMethodId
                const parentSourceMakeMethodId =
                  node.data.jobMaterialMakeMethodId;
                const parentQuantities =
                  sourceMakeMethodIdToQuantities[
                    parentSourceMakeMethodId ?? ""
                  ];
                // Children receive parent's total (estimated + scrap) for cascade
                nodeTotalForChildren = parentQuantities?.totalWithScrap ?? 1;
              }

              for await (const child of node.children) {
                // A zero-quantity Buy/Pick line is dropped from the copied job.
                // A made sub-assembly is left intact even at quantity 0: its
                // operations are copied by make method below and would reference
                // a make method that never got created if the row were removed.
                if (
                  isZeroQuantity(child.data.quantity) &&
                  child.data.methodType !== "Make to Order"
                ) {
                  continue;
                }
                const sourceMaterial = sourceMaterialById.get(child.id);
                const newMaterialId = nanoid();
                sourceMaterialIdToJobMaterialId[child.id] = newMaterialId;

                // Resolve the supersession FIRST — see the note in
                // itemToJobMakeMethod's mapper. Every field below derives from
                // the post-swap item, so a field added later follows
                // automatically. Buy/Pick only — made sub-assemblies keep the
                // source job's structure (their successors' methods would have
                // to be re-exploded from the item side).
                const supersession = await resolveJobMaterialSupersession(
                  trx,
                  companyId,
                  supersessionRedirect,
                  {
                    itemId: child.data.itemId,
                    methodType: child.data.methodType
                  }
                );
                const itemId = supersession?.itemId ?? child.data.itemId;
                const quantityPerParent =
                  (child.data.quantity ?? 1) * (supersession?.factor ?? 1);

                // Get scrap percentage for this item
                const itemScrapPercentage = await itemDefaults.scrapPercentage(
                  trx,
                  itemId
                );

                // Calculate scrap quantities for this child material
                // Target = parent's total (including scrap) * quantity per parent
                const childTargetQuantity =
                  nodeTotalForChildren * quantityPerParent;
                // Scrap applies to every method type (mirrors itemToJob)
                const childScrapQuantity = scrapAllowance(
                  childTargetQuantity,
                  itemScrapPercentage
                );
                const childTotalWithScrap =
                  childTargetQuantity + childScrapQuantity;
                // For Make: estimatedQuantity is good quantity (without scrap)
                // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
                const childEstimatedQuantity =
                  child.data.methodType === "Make to Order"
                    ? childTargetQuantity
                    : childTotalWithScrap;

                // Store quantities for this child's make method (if it has one)
                if (child.data.jobMaterialMakeMethodId) {
                  sourceMakeMethodIdToQuantities[
                    child.data.jobMaterialMakeMethodId
                  ] = {
                    targetQuantity: childTargetQuantity,
                    estimatedQuantity: childEstimatedQuantity,
                    totalWithScrap: childTotalWithScrap
                  };
                }

                jobMaterialInserts.push({
                  id: newMaterialId,
                  jobId: targetJobId,
                  itemId,
                  itemType: supersession?.itemType ?? child.data.itemType,
                  kit: child.data.kit,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  description:
                    supersession?.description ?? child.data.description,
                  jobMakeMethodId:
                    child.data.jobMakeMethodId === sourceJobMakeMethod.data.id
                      ? targetJobMakeMethod.data.id
                      : sourceMakeMethodIdToJobMakeMethodId[
                          child.data.jobMakeMethodId
                        ]!,
                  quantity: quantityPerParent,
                  scrapQuantity: childScrapQuantity,
                  estimatedQuantity: childEstimatedQuantity,
                  itemScrapPercentage,
                  substitutedFromItemId:
                    supersession?.substitutedFromItemId ?? null,
                  substitutionFactor: supersession?.factor ?? null,
                  // ALWAYS set, never conditionally spread — see the note in
                  // quoteLineToJob: Kysely builds ONE column list per multi-row
                  // insert, and `unitCost` is NOT NULL DEFAULT 0.
                  unitCost: supersession
                    ? (supersession.unitCost ?? 0)
                    : (sourceMaterial?.unitCost ?? child.data.unitCost ?? 0),
                  // The bin belongs to the post-swap item; an explicit bin on
                  // the source job's line still wins.
                  storageUnitId: await itemDefaults.storageUnitId(
                    trx,
                    itemId,
                    child.data.storageUnitId ?? undefined
                  ),
                  requiresBatchTracking:
                    supersession?.requiresBatchTracking ??
                    sourceMaterial?.requiresBatchTracking ??
                    false,
                  requiresSerialTracking:
                    supersession?.requiresSerialTracking ??
                    sourceMaterial?.requiresSerialTracking ??
                    false,
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });

                if (child.data.jobMaterialMakeMethodId) {
                  const newMakeMethodId = nanoid();
                  sourceMakeMethodIdToJobMakeMethodId[
                    child.data.jobMaterialMakeMethodId
                  ] = newMakeMethodId;
                  jobMakeMethodInserts.push({
                    id: newMakeMethodId,
                    jobId: targetJobId,
                    parentMaterialId: sourceMaterialIdToJobMaterialId[child.id],
                    itemId: child.data.itemId,
                    quantityPerParent: child.data.quantity,
                    companyId,
                    createdBy: userId
                  });
                }
              }

              if (parts.billOfMaterial && jobMaterialInserts.length > 0) {
                // The supersession swap happens where each row is built, before
                // any field derives from the item — there is deliberately no
                // second pass here.
                await trx
                  .insertInto("jobMaterial")
                  .values(jobMaterialInserts)
                  .execute();
                insertedJobMaterialIds.push(
                  ...jobMaterialInserts.flatMap((m) => (m.id ? [m.id] : []))
                );
              }

              if (parts.billOfMaterial && jobMakeMethodInserts.length > 0) {
                await renameMakeMethods(trx, {
                  table: "jobMakeMethod",
                  companyId,
                  scope: { column: "jobId", value: targetJobId },
                  rows: jobMakeMethodInserts.map((insert) => ({
                    parentMaterialId: insert.parentMaterialId!,
                    id: insert.id!,
                    quantityPerParent: insert.quantityPerParent
                  }))
                });
              }
            }
          );

          if (parts.billOfProcess) {
            const jobOperationInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
              sourceOperationRows.map((op) => {
                // Get quantities for this operation's SOURCE make method
                const opQuantities =
                  sourceMakeMethodIdToQuantities[op.jobMakeMethodId ?? ""];
                // The traversal stores quantities for every make method in the
                // tree, so a miss means the operation references an orphaned
                // make method. Fail the conversion (rolls back the transaction)
                // instead of silently inserting a zero-quantity operation with
                // a NULL jobMakeMethodId.
                if (!opQuantities) {
                  throw new Error(
                    `No quantities found for source job make method ${op.jobMakeMethodId} referenced by operation ${op.id} — the job method tree and its operations are out of sync`
                  );
                }
                return {
                  jobId: targetJobId,
                  jobMakeMethodId:
                    op.jobMakeMethodId === sourceJobMakeMethod.data.id
                      ? targetJobMakeMethod.data.id
                      : sourceMakeMethodIdToJobMakeMethodId[
                          op.jobMakeMethodId!
                        ],
                  processId: op.processId,
                  procedureId: op.procedureId,
                  workCenterId: op.workCenterId,
                  description: op.description,
                  setupTime: op.setupTime,
                  setupUnit: op.setupUnit,
                  laborTime: op.laborTime,
                  laborUnit: op.laborUnit,
                  machineTime: op.machineTime,
                  machineUnit: op.machineUnit,
                  order: op.order,
                  operationOrder: op.operationOrder,
                  operationType: op.operationType,
                  // Carry the Assembly → BOP sync link so the MES can drive the
                  // animated instruction player on the copied job.
                  assemblyInstructionId: op.assemblyInstructionId,
                  inspectionDocumentId: op.inspectionDocumentId,
                  operationSupplierProcessId: op.operationSupplierProcessId,
                  operationMinimumCost: op.operationMinimumCost ?? 0,
                  operationLeadTime: op.operationLeadTime ?? 0,
                  operationUnitCost: op.operationUnitCost ?? 0,
                  tags: op.tags ?? [],
                  workInstruction: toJson(
                    parts.workInstructions ? op.workInstruction : {}
                  ),
                  targetQuantity: opQuantities.targetQuantity,
                  // Fractional targets flow through; the scrap allowance is already whole
                  operationQuantity: opQuantities.totalWithScrap,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                };
              });

            if (jobOperationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("jobOperation")
                .values(jobOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of sourceOperationRows.entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  sourceOperationIdToJobOperationId[operation.id] = operationId;

                  const {
                    jobOperationTool,
                    jobOperationParameter,
                    jobOperationStep,
                    procedureId
                  } = operation;

                  // Tool ids the assembly-instruction copy inserts itself, so
                  // the source job's copies of the same tools are skipped below.
                  let assemblyToolIds = new Set<string>();

                  if (procedureId) {
                    await insertProcedureDataForJobOperation(trx, {
                      operationId,
                      procedureId,
                      companyId,
                      userId
                    });
                  } else {
                    if (
                      parts.parameters &&
                      Array.isArray(jobOperationParameter) &&
                      jobOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("jobOperationParameter")
                        .values(
                          jobOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (operation.assemblyInstructionId) {
                      // Assembly ops inherit their steps from the linked
                      // instruction (fresh from the live definition, as every
                      // *-ToJob path does); material ↔ step links are flushed
                      // after the jobMaterial rows exist.
                      assemblyToolIds = await insertAssemblyDataForJobOperation(
                        trx,
                        {
                          operationId,
                          assemblyInstructionId:
                            operation.assemblyInstructionId,
                          companyId,
                          userId
                        }
                      );
                      assemblyOperationsToLink.push({
                        operationId,
                        assemblyInstructionId: operation.assemblyInstructionId
                      });
                    } else if (
                      parts.steps &&
                      Array.isArray(jobOperationStep) &&
                      jobOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("jobOperationStep")
                        .values(
                          jobOperationStep.map((step) => ({
                            operationId,
                            name: step.name,
                            type: step.type,
                            description: toTiptapDoc(step.description),
                            required: step.required,
                            sortOrder: step.sortOrder,
                            unitOfMeasureCode: step.unitOfMeasureCode,
                            minValue: step.minValue,
                            maxValue: step.maxValue,
                            listValues: step.listValues,
                            fileTypes: step.fileTypes,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .returning(["id"])
                        .execute();

                      // Bulk insert preserves order, so insertedSteps[i] ↔
                      // jobOperationStep[i]: record old step -> new step so
                      // material/tool ↔ step links can be remapped below.
                      jobOperationStep.forEach((s, i) => {
                        const newStepId = insertedSteps[i]?.id;
                        if (s?.id && newStepId) {
                          sourceStepsToJobSteps[s.id] = newStepId;
                        }
                      });

                      await copyStepSlides(
                        trx,
                        jobOperationStep,
                        insertedSteps,
                        "jobOperationStepSlide",
                        "jobOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }

                  // Tools after steps: the old-step -> new-step map is now
                  // populated, so a tool scoped to steps carries those links via
                  // jobOperationToolStep. Tools the assembly-instruction copy
                  // already inserted are skipped (see above).
                  const toolsToCopy = (
                    Array.isArray(jobOperationTool) ? jobOperationTool : []
                  ).filter((tool) => !assemblyToolIds.has(tool.toolId));
                  if (parts.tools && toolsToCopy.length > 0) {
                    const insertedTools = await trx
                      .insertInto("jobOperationTool")
                      .values(
                        toolsToCopy.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    // Tool ↔ step links. Bulk insert preserves order, so
                    // insertedTools[i] ↔ toolsToCopy[i]. A tool with no links
                    // applies to the whole operation.
                    const toolStepRows = toolsToCopy.flatMap((tool, i) => {
                      const jobOperationToolId = insertedTools[i]?.id;
                      if (!jobOperationToolId) return [];
                      const oldStepIds = (
                        (tool.jobOperationToolStep ?? []) as Array<{
                          jobOperationStepId: string | null;
                        }>
                      ).map((l) => l.jobOperationStepId);
                      return remapStepIds(
                        oldStepIds,
                        sourceStepsToJobSteps
                      ).map((jobOperationStepId) => ({
                        jobOperationToolId,
                        jobOperationStepId
                      }));
                    });
                    if (toolStepRows.length > 0) {
                      await trx
                        .insertInto("jobOperationToolStep")
                        .values(toolStepRows)
                        .execute();
                    }
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)

          // The links between materials and operations/steps can only be
          // rebuilt when BOTH sides were copied in this run — otherwise one end
          // of each link points at rows this copy never created.
          if (parts.billOfMaterial && parts.billOfProcess) {
            // Material ↔ operation links (jobMaterial.jobOperationId): the
            // materials were inserted during the traversal, before the
            // operations existed, so the link is applied as a second pass —
            // batched as one UPDATE per operation rather than one per material.
            const materialIdsByOperationId = new Map<string, string[]>();
            for (const sourceMaterial of sourceMaterialRows) {
              const newMaterialId =
                sourceMaterialIdToJobMaterialId[sourceMaterial.id];
              const newOperationId = sourceMaterial.jobOperationId
                ? sourceOperationIdToJobOperationId[
                    sourceMaterial.jobOperationId
                  ]
                : undefined;
              if (newMaterialId && newOperationId) {
                const ids = materialIdsByOperationId.get(newOperationId) ?? [];
                ids.push(newMaterialId);
                materialIdsByOperationId.set(newOperationId, ids);
              }
            }
            const operationByMaterial = [...materialIdsByOperationId].flatMap(
              ([operationId, materialIds]) =>
                materialIds.map(
                  (materialId) =>
                    sql`(${materialId}::text, ${operationId}::text)`
                )
            );
            for (const chunk of chunked(operationByMaterial)) {
              await sql`
                UPDATE "jobMaterial" AS t
                SET "jobOperationId" = v."operationId"
                FROM (VALUES ${sql.join(chunk)}) AS v("materialId", "operationId")
                WHERE t."id" = v."materialId" AND t."companyId" = ${companyId}
              `.execute(trx);
            }

            // Material ↔ step links (jobMaterialStep), remapped onto the new
            // material and step ids. Links to procedure/assembly-materialized
            // steps drop out of the map (assembly links are rebuilt from the
            // instruction by linkAssemblyStepMaterialsForJobOperations below).
            const materialStepRows = sourceMaterialRows.flatMap(
              (sourceMaterial) => {
                const newMaterialId =
                  sourceMaterialIdToJobMaterialId[sourceMaterial.id];
                if (!newMaterialId) return [];
                return (sourceMaterial.jobMaterialStep ?? []).flatMap(
                  (link) => {
                    const newStepId = link.jobOperationStepId
                      ? sourceStepsToJobSteps[link.jobOperationStepId]
                      : undefined;
                    return newStepId
                      ? [
                          {
                            jobMaterialId: newMaterialId,
                            jobOperationStepId: newStepId,
                            quantity: link.quantity
                          }
                        ]
                      : [];
                  }
                );
              }
            );
            if (materialStepRows.length > 0) {
              await trx
                .insertInto("jobMaterialStep")
                .values(materialStepRows)
                .execute();
            }
          }

          // Materials were inserted before operations in this direction, so the
          // assembly material ↔ step links can flush immediately.
          await linkAssemblyStepMaterialsForJobOperations(
            trx,
            assemblyOperationsToLink,
            companyId
          );

          await settleConsumeFirstLines({
            trx,
            companyId,
            jobId: targetJobId,
            jobMaterialIds: insertedJobMaterialIds,
            locationId: targetJob.data?.locationId,
            asOfDate: jobBuildDate(targetJob.data)
          });
        });

        break;
      }
      case "makeMethodToMakeMethod": {
        const [sourceMakeMethod, targetMakeMethod] = await inOrder([
          () => single(db, "makeMethod", { id: sourceId, companyId }),
          () => single(db, "makeMethod", { id: targetId, companyId })
        ]);
        if (sourceMakeMethod.error || targetMakeMethod.error) {
          throw new Error("Failed to get make methods");
        }

        const [sourceMaterials, sourceOperations] = await inOrder([
          () =>
            parts.billOfMaterial
              ? many(db, "methodMaterial", {
                  makeMethodId: sourceMakeMethod.data.id,
                  companyId
                })
              : Promise.resolve({ data: [], error: null }),
          () =>
            parts.billOfProcess
              ? many<
                  "methodOperation",
                  Tables["methodOperation"]["Row"] & {
                    methodOperationTool: Tables["methodOperationTool"]["Row"][];
                    methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
                    methodOperationStep: Tables["methodOperationStep"]["Row"][];
                  }
                >(
                  db,
                  "methodOperation",
                  { makeMethodId: sourceMakeMethod.data.id, companyId },
                  {
                    embed: {
                      methodOperationTool: {
                        table: "methodOperationTool",
                        on: "operationId"
                      },
                      methodOperationParameter: {
                        table: "methodOperationParameter",
                        on: "operationId"
                      },
                      methodOperationStep: {
                        table: "methodOperationStep",
                        on: "operationId"
                      }
                    }
                  }
                )
              : Promise.resolve({ data: [], error: null })
        ]);

        if (sourceMaterials.error || sourceOperations.error) {
          throw new Error("Failed to get source materials or operations");
        }

        await db.transaction().execute(async (trx) => {
          // Delete existing materials and operations from target method
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "=", targetMakeMethod.data.id)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("methodOperation")
                  .where("makeMethodId", "=", targetMakeMethod.data.id)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);

          // Copy materials from source to target, dropping any zero-quantity
          // BOM lines.
          const materialsToCopy = (
            (sourceMaterials.data ??
              []) as Database["public"]["Tables"]["methodMaterial"]["Row"][]
          ).filter((material) => !isZeroQuantity(material.quantity));
          if (parts.billOfMaterial && materialsToCopy.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialsToCopy.map((material) => ({
                  ...material,
                  productionQuantity: undefined,
                  id: undefined, // Let the database generate a new ID
                  makeMethodId: targetMakeMethod.data.id,
                  createdBy: userId
                }))
              )
              .execute();
          }

          // Copy operations from source to target
          if (
            parts.billOfProcess &&
            sourceOperations.data &&
            sourceOperations.data.length > 0
          ) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                sourceOperations.data.map(
                  ({
                    methodOperationTool: _tools,
                    methodOperationParameter: _parameters,
                    methodOperationStep: _attributes,
                    ...operation
                  }) => {
                    const insert = {
                      ...operation,
                      id: undefined, // Let the database generate a new ID
                      makeMethodId: targetMakeMethod.data.id,
                      createdBy: userId
                    };
                    if (!parts.workInstructions) {
                      insert.workInstruction = {};
                    }
                    return insert;
                  }
                )
              )
              .returning(["id"])
              .execute();

            for await (const [
              index,
              operation
            ] of sourceOperations.data.entries()) {
              const {
                methodOperationTool,
                methodOperationParameter,
                methodOperationStep,
                procedureId
              } = operation;
              const operationId = operationIds[index]!.id;

              if (
                parts.tools &&
                operationId &&
                Array.isArray(methodOperationTool) &&
                methodOperationTool.length > 0
              ) {
                await trx
                  .insertInto("methodOperationTool")
                  .values(
                    methodOperationTool.map((tool) => ({
                      toolId: tool.toolId,
                      quantity: tool.quantity,
                      operationId,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .execute();
              }

              if (!procedureId) {
                if (
                  parts.parameters &&
                  Array.isArray(methodOperationParameter) &&
                  methodOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationParameter")
                    .values(
                      methodOperationParameter.map((param) => ({
                        operationId: operationId!,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (
                  parts.steps &&
                  // Assembly ops inherit steps from the linked instruction —
                  // never copy (possibly stale) template steps alongside it.
                  !operation.assemblyInstructionId &&
                  Array.isArray(methodOperationStep) &&
                  methodOperationStep.length > 0
                ) {
                  const insertedSteps = await trx
                    .insertInto("methodOperationStep")
                    .values(
                      methodOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
                        description: toTiptapDoc(attribute.description),
                        operationId: operationId!,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .returning(["id"])
                    .execute();

                  await copyStepSlides(
                    trx,
                    methodOperationStep,
                    insertedSteps,
                    "methodOperationStepSlide",
                    "methodOperationStepSlide",
                    companyId,
                    userId
                  );
                }
              }
            }
          }
        });
        break;
      }
      case "procedureToOperation": {
        const procedureId = sourceId;
        const operationId = targetId;
        if (!procedureId) {
          throw new Error("Invalid sourceId");
        }

        if (!operationId) {
          throw new Error("Invalid targetId");
        }

        const [procedure, operation] = await inOrder([
          () =>
            single<
              "procedure",
              Tables["procedure"]["Row"] & {
                procedureStep: Tables["procedureStep"]["Row"][];
                procedureParameter: Tables["procedureParameter"]["Row"][];
              }
            >(
              db,
              "procedure",
              { id: procedureId, companyId },
              {
                embed: {
                  procedureStep: { table: "procedureStep", on: "procedureId" },
                  procedureParameter: {
                    table: "procedureParameter",
                    on: "procedureId"
                  }
                }
              }
            ),
          () =>
            single<
              "jobOperation",
              Tables["jobOperation"]["Row"] & {
                jobOperationStep: Tables["jobOperationStep"]["Row"][];
              }
            >(
              db,
              "jobOperation",
              { id: operationId, companyId },
              {
                embed: {
                  jobOperationStep: {
                    table: "jobOperationStep",
                    on: "operationId"
                  }
                }
              }
            )
        ]);

        if (procedure.error) {
          throw new Error("Failed to get procedure");
        }

        if (operation.error) {
          throw new Error("Failed to get operation");
        }

        const existingSteps = operation.data?.jobOperationStep ?? [];

        await db.transaction().execute(async (trx) => {
          // Update or delete existing attributes
          for (const existingStep of existingSteps) {
            const matchingProcedureStep = procedure.data.procedureStep.find(
              (pa) =>
                pa.name === existingStep.name && pa.type === existingStep.type
            );

            if (matchingProcedureStep) {
              // Update matching attribute
              await trx
                .updateTable("jobOperationStep")
                .set({
                  description: matchingProcedureStep.description,
                  minValue: matchingProcedureStep.minValue,
                  maxValue: matchingProcedureStep.maxValue,
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                })
                .where("id", "=", existingStep.id)
                .where("companyId", "=", companyId)
                .execute();
            } else {
              // Delete non-matching attribute
              await trx
                .deleteFrom("jobOperationStep")
                .where("id", "=", existingStep.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          // Delete all existing parameters
          await trx
            .deleteFrom("jobOperationParameter")
            .where("operationId", "=", operationId)
            .where("companyId", "=", companyId)
            .execute();

          // Add new attributes that don't exist yet
          const newSteps = procedure.data.procedureStep.filter(
            (pa) =>
              !existingSteps.some(
                (ea) => ea.name === pa.name && ea.type === pa.type
              )
          );

          if (newSteps.length > 0) {
            await trx
              .insertInto("jobOperationStep")
              .values(
                newSteps.map((attr) => ({
                  operationId: operationId,
                  name: attr.name,
                  type: attr.type,
                  description: toTiptapDoc(attr.description),
                  minValue: attr.minValue,
                  maxValue: attr.maxValue,
                  companyId,
                  createdBy: userId,
                  updatedBy: userId
                }))
              )
              .execute();
          }

          // Add all parameters from procedure
          if (procedure.data.procedureParameter.length > 0) {
            await trx
              .insertInto("jobOperationParameter")
              .values(
                procedure.data.procedureParameter.map((param) => ({
                  operationId: operationId,
                  companyId,
                  key: param.key,
                  value: param.value,
                  createdBy: userId,
                  updatedBy: userId
                }))
              )
              .execute();
          }

          // update work instruction
          await trx
            .updateTable("jobOperation")
            .set({
              workInstruction: toJson(procedure.data.content),
              procedureId: procedureId
            })
            .where("id", "=", operationId)
            .where("companyId", "=", companyId)
            .execute();
        });
        break;
      }
      case "quoteLineToItem": {
        const [quoteId, quoteLineId] = (sourceId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid sourceId");
        }
        const makeMethodId = targetId;

        const [makeMethod, quoteMakeMethod, quoteOperations] = await inOrder([
          () => single(db, "makeMethod", { id: makeMethodId, companyId }),
          () =>
            single(db, "quoteMakeMethod", {
              quoteLineId,
              parentMaterialId: isNull,
              companyId
            }),
          () =>
            many<
              "quoteOperationsWithMakeMethods",
              Views["quoteOperationsWithMakeMethods"]["Row"] & {
                quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
                quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
                quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
              }
            >(
              db,
              "quoteOperationsWithMakeMethods",
              { quoteLineId, companyId },
              {
                embed: {
                  quoteOperationTool: {
                    table: "quoteOperationTool",
                    on: "operationId"
                  },
                  quoteOperationParameter: {
                    table: "quoteOperationParameter",
                    on: "operationId"
                  },
                  quoteOperationStep: {
                    table: "quoteOperationStep",
                    on: "operationId"
                  }
                }
              }
            )
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        if (quoteOperations.error) {
          throw new Error("Failed to get quote operations");
        }

        const itemId = makeMethod.data?.itemId;

        const [quote, quoteMethodTrees, itemReplenishment] = await inOrder([
          () => single(db, "quote", { id: quoteId, companyId }),
          () => getQuoteMethodTree(db, quoteMakeMethod.data.id),
          () => single(db, "itemReplenishment", { itemId, companyId })
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree) throw new NotFoundError("Method tree not found");

        const madeItemIds: string[] = [];

        await traverseQuoteMethod(
          quoteMethodTree,
          (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make to Order") {
              madeItemIds.push(node.data.itemId);
            }
          }
        );

        const makeMethods = await many(db, "activeMakeMethods", {
          itemId: madeItemIds,
          companyId
        });
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          if (m.itemId) {
            // @ts-expect-error - itemId is not null
            makeMethodByItemId[m.itemId!] = m.id;
          }
        });

        await db.transaction().execute(async (trx) => {
          let makeMethodsToDelete: string[] = [];
          const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
            [];
          const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
            [];

          await traverseQuoteMethod(
            quoteMethodTree,
            (node: QuoteMethodTreeItem) => {
              if (
                node.data.itemId &&
                node.data.methodType === "Make to Order"
              ) {
                makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
              }

              node.children.forEach((child) => {
                // A zero-quantity BOM line is dropped from the saved method.
                if (isZeroQuantity(child.data.quantity)) return;
                materialInserts.push({
                  makeMethodId: makeMethodByItemId[node.data.itemId]!,
                  materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                  itemId: child.data.itemId,
                  itemType: child.data.itemType,
                  kit: child.data.kit,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  quantity: child.data.quantity,
                  storageUnitIds: quote.data?.locationId
                    ? // @ts-ignore: storageUnitIds is a dynamic object with location keys
                      {
                        [quote.data.locationId]:
                          child.data.storageUnitId || null
                      }
                    : {},
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });
              });
            }
          );

          if (makeMethodsToDelete.length > 0) {
            makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
              mm === makeMethodByItemId[quoteMakeMethod.data.itemId]
                ? makeMethod.data.id
                : mm
            );
            await Promise.all([
              parts.billOfMaterial
                ? trx
                    .deleteFrom("methodMaterial")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              parts.billOfProcess
                ? trx
                    .deleteFrom("methodOperation")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve()
            ]);
          }

          if (parts.billOfMaterial && materialInserts.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialInserts.map((insert) => ({
                  ...insert,
                  productionQuantity: undefined,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === quoteMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId
                }))
              )
              .execute();
          }

          if (parts.billOfProcess) {
            quoteOperations.data?.forEach((op) => {
              operationInserts.push({
                makeMethodId: op.makeMethodId!,
                processId: op.processId!,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId: op.workCenterId,
                description: op.description ?? "",
                setupTime: op.setupTime ?? 0,
                setupUnit: op.setupUnit ?? "Total Minutes",
                laborTime: op.laborTime ?? 0,
                laborUnit: op.laborUnit ?? "Minutes/Piece",
                machineTime: op.machineTime ?? 0,
                machineUnit: op.machineUnit ?? "Minutes/Piece",
                order: op.order ?? 1,
                operationOrder: op.operationOrder ?? "After Previous",
                operationType: op.operationType ?? "Process",
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });

            if (operationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("methodOperation")
                .values(
                  operationInserts.map((insert) => ({
                    ...insert,
                    makeMethodId:
                      insert.makeMethodId ===
                      makeMethodByItemId[quoteMakeMethod.data.itemId]
                        ? makeMethod.data.id
                        : insert.makeMethodId
                  }))
                )
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                quoteOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    quoteOperationTool,
                    quoteOperationParameter,
                    quoteOperationStep,
                    procedureId
                  } = operation;

                  if (
                    parts.tools &&
                    Array.isArray(quoteOperationTool) &&
                    quoteOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationTool")
                      .values(
                        quoteOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (!procedureId) {
                    if (
                      parts.parameters &&
                      Array.isArray(quoteOperationParameter) &&
                      quoteOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("methodOperationParameter")
                        .values(
                          quoteOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (
                      parts.steps &&
                      // Assembly ops inherit steps from the linked instruction —
                      // never copy (possibly stale) quote steps alongside it.
                      !operation.assemblyInstructionId &&
                      Array.isArray(quoteOperationStep) &&
                      quoteOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("methodOperationStep")
                        .values(
                          quoteOperationStep.map(
                            ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              description: toTiptapDoc(attribute.description),
                              operationId,
                              companyId,
                              createdBy: userId
                            })
                          )
                        )
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        quoteOperationStep,
                        insertedSteps,
                        "quoteOperationStepSlide",
                        "methodOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)
        });

        break;
      }
      case "quoteMakeMethodToItem": {
        const quoteMakeMethodId = sourceId;
        const makeMethodId = targetId;

        const [makeMethod, quoteMakeMethod] = await inOrder([
          () => single(db, "makeMethod", { id: makeMethodId, companyId }),
          () =>
            single(db, "quoteMakeMethod", { id: quoteMakeMethodId, companyId })
        ]);

        if (makeMethod.error) {
          throw new Error("Failed to get make method");
        }

        if (quoteMakeMethod.error) {
          throw new Error("Failed to get quote make method");
        }

        const itemId = makeMethod.data?.itemId;

        const [quoteOperations, itemReplenishment] = await inOrder([
          () =>
            many<
              "quoteOperationsWithMakeMethods",
              Views["quoteOperationsWithMakeMethods"]["Row"] & {
                quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
                quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
                quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
              }
            >(
              db,
              "quoteOperationsWithMakeMethods",
              { quoteLineId: quoteMakeMethod.data.quoteLineId, companyId },
              {
                embed: {
                  quoteOperationTool: {
                    table: "quoteOperationTool",
                    on: "operationId"
                  },
                  quoteOperationParameter: {
                    table: "quoteOperationParameter",
                    on: "operationId"
                  },
                  quoteOperationStep: {
                    table: "quoteOperationStep",
                    on: "operationId"
                  }
                }
              }
            ),
          () => single(db, "itemReplenishment", { itemId, companyId })
        ]);

        if (quoteOperations.error) {
          throw new Error("Failed to get quote operations");
        }

        if (itemReplenishment.error) {
          throw new Error("Failed to get item replenishment");
        }

        if (itemReplenishment.data?.requiresConfiguration) {
          throw new Error("Cannot override method of configured item");
        }

        const [quoteMethodTrees] = await inOrder([
          () =>
            getQuoteMethodTree(
              db,
              quoteMakeMethodId,
              quoteMakeMethod.data.parentMaterialId
            )
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree)
          throw new NotFoundError("Job method tree not found");

        const madeItemIds: string[] = [];

        // Awaited: the walk is async, and without it only the root had been
        // visited when the make methods below were read, so a sub-assembly
        // inside this one had no make method to save its materials under.
        await traverseQuoteMethod(
          quoteMethodTree,
          (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make to Order") {
              madeItemIds.push(node.data.itemId);
            }
          }
        );

        const makeMethods = await many(db, "activeMakeMethods", {
          itemId: madeItemIds,
          companyId
        });
        if (makeMethods.error) {
          throw new Error("Failed to get make methods");
        }

        const makeMethodByItemId: Record<string, string> = {};
        makeMethods.data?.forEach((m) => {
          if (m.itemId) {
            // @ts-expect-error - itemId is not null
            makeMethodByItemId[m.itemId!] = m.id;
          }
        });

        await db.transaction().execute(async (trx) => {
          let makeMethodsToDelete: string[] = [];
          const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
            [];
          const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
            [];

          await traverseQuoteMethod(
            quoteMethodTree!,
            (node: QuoteMethodTreeItem) => {
              if (
                node.data.itemId &&
                node.data.methodType === "Make to Order"
              ) {
                makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
              }

              node.children.forEach((child) => {
                // A zero-quantity BOM line is dropped from the saved method.
                if (isZeroQuantity(child.data.quantity)) return;
                materialInserts.push({
                  makeMethodId: makeMethodByItemId[node.data.itemId]!,
                  materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                  itemId: child.data.itemId,
                  kit: child.data.kit,
                  itemType: child.data.itemType,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  quantity: child.data.quantity,
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });
              });
            }
          );

          if (makeMethodsToDelete.length > 0) {
            makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
              mm === makeMethodByItemId[quoteMakeMethod.data.itemId]
                ? makeMethod.data.id
                : mm
            );
            await Promise.all([
              parts.billOfMaterial
                ? trx
                    .deleteFrom("methodMaterial")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve(),
              parts.billOfProcess
                ? trx
                    .deleteFrom("methodOperation")
                    .where("makeMethodId", "in", makeMethodsToDelete)
                    .where("companyId", "=", companyId)
                    .execute()
                : Promise.resolve()
            ]);
          }

          if (parts.billOfMaterial && materialInserts.length > 0) {
            await trx
              .insertInto("methodMaterial")
              .values(
                materialInserts.map((insert) => ({
                  ...insert,
                  productionQuantity: undefined,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId,
                  itemId:
                    insert.itemId === quoteMakeMethod.data.itemId
                      ? itemId
                      : insert.itemId
                }))
              )
              .execute();
          }

          if (parts.billOfProcess) {
            quoteOperations.data?.forEach((op) => {
              operationInserts.push({
                makeMethodId: op.makeMethodId!,
                processId: op.processId!,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId: op.workCenterId,
                description: op.description ?? "",
                setupTime: op.setupTime ?? 0,
                setupUnit: op.setupUnit ?? "Total Minutes",
                laborTime: op.laborTime ?? 0,
                laborUnit: op.laborUnit ?? "Minutes/Piece",
                machineTime: op.machineTime ?? 0,
                machineUnit: op.machineUnit ?? "Minutes/Piece",
                order: op.order ?? 1,
                operationOrder: op.operationOrder ?? "After Previous",
                operationType: op.operationType ?? "Process",
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });

            if (operationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("methodOperation")
                .values(
                  operationInserts.map((insert) => ({
                    ...insert,
                    makeMethodId:
                      insert.makeMethodId ===
                      makeMethodByItemId[quoteMakeMethod.data.itemId]
                        ? makeMethod.data.id
                        : insert.makeMethodId
                  }))
                )
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                quoteOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    quoteOperationTool,
                    quoteOperationParameter,
                    quoteOperationStep,
                    procedureId
                  } = operation;

                  if (
                    parts.tools &&
                    Array.isArray(quoteOperationTool) &&
                    quoteOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationTool")
                      .values(
                        quoteOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (!procedureId) {
                    if (
                      parts.parameters &&
                      Array.isArray(quoteOperationParameter) &&
                      quoteOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("methodOperationParameter")
                        .values(
                          quoteOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (
                      parts.steps &&
                      // Assembly ops inherit steps from the linked instruction —
                      // never copy (possibly stale) quote steps alongside it.
                      !operation.assemblyInstructionId &&
                      Array.isArray(quoteOperationStep) &&
                      quoteOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("methodOperationStep")
                        .values(
                          quoteOperationStep.map(
                            ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              description: toTiptapDoc(attribute.description),
                              operationId,
                              companyId,
                              createdBy: userId
                            })
                          )
                        )
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        quoteOperationStep,
                        insertedSteps,
                        "quoteOperationStepSlide",
                        "methodOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)
        });

        break;
      }
      case "quoteLineToJob": {
        const jobId = targetId;
        if (!jobId) {
          throw new Error("Invalid targetId");
        }

        const [quoteId, quoteLineId] = (sourceId as string).split(":");
        if (!quoteId || !quoteLineId) {
          throw new Error("Invalid sourceId");
        }
        // Assembly ops whose steps were materialized from an instruction —
        // material ↔ step links flush after the jobMaterial rows exist.
        const assemblyOperationsToLink: Array<{
          operationId: string;
          assemblyInstructionId: string;
        }> = [];

        const job = await single(db, "job", { id: jobId, companyId });
        const jobMakeMethod = await single(db, "jobMakeMethod", {
          jobId,
          parentMaterialId: isNull,
          companyId
        });
        const quoteMakeMethod = await single(db, "quoteMakeMethod", {
          parentMaterialId: isNull,
          quoteLineId,
          companyId
        });
        const quoteMaterials = await many(db, "quoteMaterial", {
          quoteLineId,
          companyId
        });
        const quoteOperations = await many<
          "quoteOperation",
          QuoteOperationWithDetails
        >(
          db,
          "quoteOperation",
          { quoteLineId, companyId },
          { embed: quoteOperationDetails }
        );

        if (job.error) {
          throw new Error("Failed to get job");
        }

        if (jobMakeMethod.error || !jobMakeMethod.data) {
          throw new Error("Failed to get job make method");
        }

        if (
          quoteMakeMethod.error ||
          quoteMaterials.error ||
          quoteOperations.error
        ) {
          if (quoteMakeMethod.error) {
            logger.error("quoteMakeMethodError", {
              error: quoteMakeMethod.error
            });
          }
          if (quoteMaterials.error) {
            logger.error("quoteMaterialsError", {
              error: quoteMaterials.error
            });
          }
          if (quoteOperations.error) {
            logger.error("quoteOperationsError", {
              error: quoteOperations.error
            });
          }
          throw new Error("Failed to fetch quote data");
        }

        const quoteMethodTrees = await getQuoteMethodTree(
          db,
          quoteMakeMethod.data.id
        );

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree) throw new NotFoundError("Method tree not found");

        // Loaded ONCE per request, before the transaction — as itemToJob does.
        // This read pages the company's whole itemSupersession table, and it used
        // to sit inside the per-node traverseQuoteMethod callback, so a BOM of N
        // nodes issued N full-table reads sequentially inside the transaction
        // holding the pool's single connection. The map depends only on the
        // company and the job's build date, both fixed for the request.
        const { redirect: supersessionRedirect } =
          await loadSupersessionRedirect(db, companyId, job.data);
        const itemDefaults = createItemDefaults(companyId, job.data.locationId);

        const quoteMaterialIdToJobMaterialId: Record<string, string> = {};
        const quoteMakeMethodIdToJobMakeMethodId: Record<string, string> = {};
        // Track estimated quantities for each make method to set on operations
        const quoteMakeMethodIdToQuantities: Record<
          string,
          {
            targetQuantity: number;
            estimatedQuantity: number;
            totalWithScrap: number;
          }
        > = {};

        await db.transaction().execute(async (trx) => {
          await itemDefaults.load(
            trx,
            treeItemIds(quoteMethodTree, supersessionRedirect)
          );
          // Delete existing jobMakeMethods, jobMaterials, and jobOperations for this job
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMakeMethod")
                  .where((eb) =>
                    eb.and([
                      eb("jobId", "=", jobId),
                      eb("parentMaterialId", "is not", null)
                    ])
                  )
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfMaterial
              ? trx
                  .deleteFrom("jobMaterial")
                  .where("jobId", "=", jobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            // Prevent cascade deletion of materials when only replacing operations
            !parts.billOfMaterial && parts.billOfProcess
              ? trx
                  .updateTable("jobMaterial")
                  .set({ jobOperationId: null })
                  .where("jobId", "=", jobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("jobOperation")
                  .where("jobId", "=", jobId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);

          const insertedJobMaterialIds: string[] = [];
          await traverseQuoteMethod(
            quoteMethodTree,
            async (node: QuoteMethodTreeItem) => {
              const jobMaterialInserts: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
                [];
              const jobMakeMethodInserts: Database["public"]["Tables"]["jobMakeMethod"]["Insert"][] =
                [];

              // Get the total quantity for this node (parent level) to pass to children
              // This is estimated + scrap for Make parts (what children use for their target calculation)
              let nodeTotalForChildren: number;
              if (node.data.isRoot) {
                // Root: target = job quantity, calculate scrap and total
                const rootScrapPercentage = await itemDefaults.scrapPercentage(
                  trx,
                  node.data.itemId
                );
                const rootTarget = job.data?.quantity ?? 1;
                // Scrap applies to every method type (mirrors itemToJob)
                const rootScrapQuantity = scrapAllowance(
                  rootTarget,
                  rootScrapPercentage
                );
                const rootTotalWithScrap = rootTarget + rootScrapQuantity;
                // For Make: estimatedQuantity is good quantity (without scrap)
                // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
                const rootEstimatedQuantity =
                  node.data.methodType === "Make to Order"
                    ? rootTarget
                    : rootTotalWithScrap;

                nodeTotalForChildren = rootTotalWithScrap;

                // Store root quantities
                quoteMakeMethodIdToQuantities[quoteMakeMethod.data.id] = {
                  targetQuantity: rootTarget,
                  estimatedQuantity: rootEstimatedQuantity,
                  totalWithScrap: rootTotalWithScrap
                };
              } else {
                // Non-root: get from stored quantities using parent's quoteMakeMethodId
                const parentQuoteMakeMethodId =
                  node.data.quoteMaterialMakeMethodId;
                const parentQuantities =
                  quoteMakeMethodIdToQuantities[parentQuoteMakeMethodId ?? ""];
                // Children receive parent's total (estimated + scrap) for cascade
                nodeTotalForChildren = parentQuantities?.totalWithScrap ?? 1;
              }

              for await (const child of node.children) {
                // A zero-quantity Buy/Pick line is dropped from the created job.
                // A made sub-assembly is left intact even at quantity 0: its
                // operations are copied by make method below and would reference
                // a make method that never got created if the row were removed.
                if (
                  isZeroQuantity(child.data.quantity) &&
                  child.data.methodType !== "Make to Order"
                ) {
                  continue;
                }
                const newMaterialId = nanoid();
                quoteMaterialIdToJobMaterialId[child.id] = newMaterialId;

                // Resolve the supersession FIRST — see the note in
                // itemToJobMakeMethod's mapper. Deriving the scrap rate, bin and
                // quantities from the pre-swap item and patching the row
                // afterwards is what left swapped lines costing the
                // predecessor's scrap; swapping up front means every field here,
                // and any field added later, is computed for the item the row
                // ends up being for. Buy/Pick only — made sub-assemblies are not
                // swapped on the quote path at all (their successors' methods
                // would have to be re-exploded from the item side).
                const supersession = await resolveJobMaterialSupersession(
                  trx,
                  companyId,
                  supersessionRedirect,
                  {
                    itemId: child.data.itemId,
                    methodType: child.data.methodType
                  }
                );
                const itemId = supersession?.itemId ?? child.data.itemId;
                const quantityPerParent =
                  (child.data.quantity ?? 1) * (supersession?.factor ?? 1);

                // Get scrap percentage for this item
                const itemScrapPercentage = await itemDefaults.scrapPercentage(
                  trx,
                  itemId
                );

                // Calculate scrap quantities for this child material
                // Target = parent's total (including scrap) * quantity per parent
                const childTargetQuantity =
                  nodeTotalForChildren * quantityPerParent;
                // Scrap applies to every method type (mirrors itemToJob)
                const childScrapQuantity = scrapAllowance(
                  childTargetQuantity,
                  itemScrapPercentage
                );
                const childTotalWithScrap =
                  childTargetQuantity + childScrapQuantity;
                // For Make: estimatedQuantity is good quantity (without scrap)
                // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
                const childEstimatedQuantity =
                  child.data.methodType === "Make to Order"
                    ? childTargetQuantity
                    : childTotalWithScrap;

                // Store quantities for this child's make method (if it has one)
                if (child.data.quoteMaterialMakeMethodId) {
                  quoteMakeMethodIdToQuantities[
                    child.data.quoteMaterialMakeMethodId
                  ] = {
                    targetQuantity: childTargetQuantity,
                    estimatedQuantity: childEstimatedQuantity,
                    totalWithScrap: childTotalWithScrap
                  };
                }

                jobMaterialInserts.push({
                  id: newMaterialId,
                  jobId,
                  itemId,
                  itemType: supersession?.itemType ?? child.data.itemType,
                  kit: child.data.kit,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  description:
                    supersession?.description ?? child.data.description,
                  jobMakeMethodId:
                    child.data.quoteMakeMethodId === quoteMakeMethod.data.id
                      ? jobMakeMethod.data.id
                      : quoteMakeMethodIdToJobMakeMethodId[
                          child.data.quoteMakeMethodId
                        ]!,
                  quantity: quantityPerParent,
                  scrapQuantity: childScrapQuantity,
                  estimatedQuantity: childEstimatedQuantity,
                  itemScrapPercentage,
                  substitutedFromItemId:
                    supersession?.substitutedFromItemId ?? null,
                  substitutionFactor: supersession?.factor ?? null,
                  // ALWAYS set, never conditionally spread. Kysely builds ONE
                  // column list for a multi-row insert, so the moment a single
                  // swapped row carries `unitCost` the column joins the statement
                  // and every row that omitted the key is written NULL — and
                  // `jobMaterial.unitCost` is NOT NULL DEFAULT 0, so the whole
                  // insert fails. Omitting a key only reaches the default when NO
                  // row in the batch has it.
                  //
                  // Branch on whether a swap happened, matching the other two
                  // flows: a swapped row must not inherit the predecessor's cost,
                  // and an unswapped one keeps the quote line's own. This path
                  // never set the column before, so unswapped rows silently took
                  // the 0 default even though the quote tree carries a cost.
                  unitCost: supersession
                    ? (supersession.unitCost ?? 0)
                    : (child.data.unitCost ?? 0),
                  // The bin belongs to the post-swap item; an explicit bin on the
                  // quote line still wins.
                  storageUnitId: await itemDefaults.storageUnitId(
                    trx,
                    itemId,
                    child.data.storageUnitId
                  ),
                  requiresBatchTracking:
                    supersession?.requiresBatchTracking ??
                    child.data.itemTrackingType === "Batch",
                  requiresSerialTracking:
                    supersession?.requiresSerialTracking ??
                    child.data.itemTrackingType === "Serial",
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });

                if (child.data.quoteMaterialMakeMethodId) {
                  const newMakeMethodId = nanoid();
                  quoteMakeMethodIdToJobMakeMethodId[
                    child.data.quoteMaterialMakeMethodId
                  ] = newMakeMethodId;
                  jobMakeMethodInserts.push({
                    id: newMakeMethodId,
                    jobId,
                    parentMaterialId: quoteMaterialIdToJobMaterialId[child.id],
                    itemId: child.data.itemId,
                    quantityPerParent: child.data.quantity,
                    companyId,
                    createdBy: userId
                  });
                }
              }

              if (parts.billOfMaterial && jobMaterialInserts.length > 0) {
                // The supersession swap happens where each row is built, before
                // any field derives from the item — there is deliberately no
                // second pass here.
                await trx
                  .insertInto("jobMaterial")
                  .values(jobMaterialInserts)
                  .execute();
                insertedJobMaterialIds.push(
                  ...jobMaterialInserts.flatMap((m) => (m.id ? [m.id] : []))
                );
              }

              if (parts.billOfMaterial && jobMakeMethodInserts.length > 0) {
                await renameMakeMethods(trx, {
                  table: "jobMakeMethod",
                  companyId,
                  scope: { column: "jobId", value: jobId },
                  rows: jobMakeMethodInserts.map((insert) => ({
                    parentMaterialId: insert.parentMaterialId!,
                    id: insert.id!,
                    quantityPerParent: insert.quantityPerParent
                  }))
                });
              }
            }
          );

          if (parts.billOfProcess) {
            const jobOperationInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
              quoteOperations.data.map((op) => {
                // Get quantities for this operation's make method
                const opQuantities =
                  quoteMakeMethodIdToQuantities[op.quoteMakeMethodId ?? ""];
                // The traversal stores quantities for every make method in the
                // tree, so a miss means the operation references an orphaned
                // make method. Fail the conversion (rolls back the transaction)
                // instead of silently inserting a zero-quantity operation with
                // a NULL jobMakeMethodId.
                if (!opQuantities) {
                  throw new Error(
                    `No quantities found for quote make method ${op.quoteMakeMethodId} referenced by operation ${op.id} — the quote method tree and its operations are out of sync`
                  );
                }
                return {
                  jobId,
                  jobMakeMethodId:
                    op.quoteMakeMethodId === quoteMakeMethod.data.id
                      ? jobMakeMethod.data.id
                      : quoteMakeMethodIdToJobMakeMethodId[
                          op.quoteMakeMethodId!
                        ],
                  processId: op.processId,
                  procedureId: op.procedureId,
                  workCenterId: op.workCenterId,
                  description: op.description,
                  setupTime: op.setupTime,
                  setupUnit: op.setupUnit,
                  laborTime: op.laborTime,
                  laborUnit: op.laborUnit,
                  machineTime: op.machineTime,
                  machineUnit: op.machineUnit,
                  order: op.order,
                  operationOrder: op.operationOrder,
                  operationType: op.operationType,
                  // Carry the Assembly → BOP sync link so the MES can drive the
                  // animated instruction player on jobs made from a synced method.
                  assemblyInstructionId: op.assemblyInstructionId,
                  inspectionDocumentId: op.inspectionDocumentId,
                  operationSupplierProcessId: op.operationSupplierProcessId,
                  operationMinimumCost: op.operationMinimumCost ?? 0,
                  operationLeadTime: op.operationLeadTime ?? 0,
                  operationUnitCost: op.operationUnitCost ?? 0,
                  tags: op.tags ?? [],
                  workInstruction: toJson(
                    parts.workInstructions ? op.workInstruction : {}
                  ),
                  targetQuantity: opQuantities.targetQuantity,
                  // Fractional targets flow through; the scrap allowance is already whole
                  operationQuantity: opQuantities.totalWithScrap,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                };
              });

            if (jobOperationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("jobOperation")
                .values(jobOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                quoteOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    quoteOperationTool,
                    quoteOperationParameter,
                    quoteOperationStep,
                    procedureId
                  } = operation;
                  // abilities are not copied on this path (no quoteOperationAbility table)

                  if (
                    parts.tools &&
                    Array.isArray(quoteOperationTool) &&
                    quoteOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationTool")
                      .values(
                        quoteOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (procedureId) {
                    await insertProcedureDataForJobOperation(trx, {
                      operationId,
                      procedureId,
                      companyId,
                      userId
                    });
                  } else {
                    if (
                      parts.parameters &&
                      Array.isArray(quoteOperationParameter) &&
                      quoteOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("jobOperationParameter")
                        .values(
                          quoteOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (operation.assemblyInstructionId) {
                      // Assembly ops inherit their steps from the linked
                      // instruction (the quote only carries the pointer);
                      // material ↔ step links are flushed after the jobMaterial
                      // rows exist.
                      await insertAssemblyDataForJobOperation(trx, {
                        operationId,
                        assemblyInstructionId: operation.assemblyInstructionId,
                        companyId,
                        userId
                      });
                      assemblyOperationsToLink.push({
                        operationId,
                        assemblyInstructionId: operation.assemblyInstructionId
                      });
                    } else if (
                      parts.steps &&
                      Array.isArray(quoteOperationStep) &&
                      quoteOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("jobOperationStep")
                        .values(
                          quoteOperationStep.map(
                            ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              description: toTiptapDoc(attribute.description),
                              operationId,
                              companyId,
                              createdBy: userId
                            })
                          )
                        )
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        quoteOperationStep,
                        insertedSteps,
                        "quoteOperationStepSlide",
                        "jobOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)

          // Materials were inserted before operations in this direction, so the
          // assembly material ↔ step links can flush immediately.
          await linkAssemblyStepMaterialsForJobOperations(
            trx,
            assemblyOperationsToLink,
            companyId
          );

          await settleConsumeFirstLines({
            trx,
            companyId,
            jobId: jobId,
            jobMaterialIds: insertedJobMaterialIds,
            locationId: job.data?.locationId,
            asOfDate: jobBuildDate(job.data)
          });
        });

        break;
      }
      case "quoteLineToQuoteLine": {
        const [, sourceQuoteLineId] = (sourceId as string).split(":");
        const [targetQuoteId, targetQuoteLineId] = (targetId as string).split(
          ":"
        );
        if (!sourceQuoteLineId || !targetQuoteId || !targetQuoteLineId) {
          throw new Error("Invalid sourceId or targetId");
        }

        const [
          targetQuoteMakeMethod,
          sourceQuoteMakeMethod,
          sourceQuoteMaterials,
          sourceQuoteOperations
        ] = await inOrder([
          () =>
            single(db, "quoteMakeMethod", {
              quoteLineId: targetQuoteLineId,
              parentMaterialId: isNull,
              companyId
            }),
          () =>
            single(db, "quoteMakeMethod", {
              parentMaterialId: isNull,
              quoteLineId: sourceQuoteLineId,
              companyId
            }),
          () =>
            many(db, "quoteMaterial", {
              quoteLineId: sourceQuoteLineId,
              companyId
            }),
          () =>
            many<
              "quoteOperation",
              Tables["quoteOperation"]["Row"] & {
                quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
                quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
                quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
              }
            >(
              db,
              "quoteOperation",
              { quoteLineId: sourceQuoteLineId, companyId },
              {
                embed: {
                  quoteOperationTool: {
                    table: "quoteOperationTool",
                    on: "operationId"
                  },
                  quoteOperationParameter: {
                    table: "quoteOperationParameter",
                    on: "operationId"
                  },
                  quoteOperationStep: {
                    table: "quoteOperationStep",
                    on: "operationId"
                  }
                }
              }
            )
        ]);

        if (targetQuoteMakeMethod.error || !targetQuoteMakeMethod.data) {
          logger.error("Failed to get target quote make method", {
            error: targetQuoteMakeMethod.error
          });
          throw new Error("Failed to get target quote make method");
        }
        // targetQuoteId is written onto new rows and priced below; bind it to
        // the verified target line rather than trusting the body.
        if (targetQuoteMakeMethod.data.quoteId !== targetQuoteId) {
          throw new NotFoundError("Quote line not found");
        }

        if (
          sourceQuoteMakeMethod.error ||
          sourceQuoteMaterials.error ||
          sourceQuoteOperations.error
        ) {
          throw new Error("Failed to source quote data");
        }

        const [quoteMethodTrees] = await inOrder([
          () => getQuoteMethodTree(db, sourceQuoteMakeMethod.data.id)
        ]);

        if (quoteMethodTrees.error) {
          throw new Error("Failed to get method tree");
        }

        const quoteMethodTree = quoteMethodTrees
          .data?.[0] as QuoteMethodTreeItem;
        if (!quoteMethodTree) throw new NotFoundError("Method tree not found");

        const quoteMaterialIdToQuoteMaterialId: Record<string, string> = {};
        const quoteMakeMethodIdToQuoteMakeMethodId: Record<string, string> = {};

        await db.transaction().execute(async (trx) => {
          // Delete existing quoteMakeMethods, quoteMaterials, and quoteOperations for this quote line
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("quoteMakeMethod")
                  .where((eb) =>
                    eb.and([
                      eb("quoteLineId", "=", targetQuoteLineId),
                      eb("parentMaterialId", "is not", null)
                    ])
                  )
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfMaterial
              ? trx
                  .deleteFrom("quoteMaterial")
                  .where("quoteLineId", "=", targetQuoteLineId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            // Prevent cascade deletion of materials when only replacing operations
            !parts.billOfMaterial && parts.billOfProcess
              ? trx
                  .updateTable("quoteMaterial")
                  .set({ quoteOperationId: null })
                  .where("quoteLineId", "=", targetQuoteLineId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("quoteOperation")
                  .where("quoteLineId", "=", targetQuoteLineId)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);

          await traverseQuoteMethod(
            quoteMethodTree,
            async (node: QuoteMethodTreeItem) => {
              const quoteMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
                [];
              const quoteMakeMethodInserts: Database["public"]["Tables"]["quoteMakeMethod"]["Insert"][] =
                [];

              for await (const child of node.children) {
                // A zero-quantity Buy/Pick line is dropped from the copied quote.
                // A made sub-assembly is left intact even at quantity 0: its
                // operations are copied by make method below and would reference
                // a make method that never got created if the row were removed.
                if (
                  isZeroQuantity(child.data.quantity) &&
                  child.data.methodType !== "Make to Order"
                ) {
                  continue;
                }
                const newMaterialId = nanoid();
                quoteMaterialIdToQuoteMaterialId[child.id] = newMaterialId;

                quoteMaterialInserts.push({
                  id: newMaterialId,
                  quoteId: targetQuoteId,
                  quoteLineId: targetQuoteLineId,
                  itemId: child.data.itemId,
                  kit: child.data.kit,
                  itemType: child.data.itemType,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  description: child.data.description,
                  quoteMakeMethodId:
                    child.data.quoteMakeMethodId ===
                    sourceQuoteMakeMethod.data.id
                      ? targetQuoteMakeMethod.data.id
                      : quoteMakeMethodIdToQuoteMakeMethodId[
                          child.data.quoteMakeMethodId
                        ]!,
                  quantity: child.data.quantity,
                  storageUnitId: child.data.storageUnitId,
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  unitCost: child.data.unitCost ?? 0, // TODO: get real unit cost
                  unitCostSource: child.data.unitCostSource ?? "system",
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });

                if (child.data.quoteMaterialMakeMethodId) {
                  const newMakeMethodId = nanoid();
                  quoteMakeMethodIdToQuoteMakeMethodId[
                    child.data.quoteMaterialMakeMethodId
                  ] = newMakeMethodId;
                  quoteMakeMethodInserts.push({
                    id: newMakeMethodId,
                    quoteId: targetQuoteId,
                    quoteLineId: targetQuoteLineId,
                    parentMaterialId:
                      quoteMaterialIdToQuoteMaterialId[child.id],
                    itemId: child.data.itemId,
                    quantityPerParent: child.data.quantity,
                    companyId,
                    createdBy: userId
                  });
                }
              }

              if (parts.billOfMaterial && quoteMaterialInserts.length > 0) {
                await trx
                  .insertInto("quoteMaterial")
                  .values(quoteMaterialInserts)
                  .execute();
              }

              if (parts.billOfMaterial && quoteMakeMethodInserts.length > 0) {
                await renameMakeMethods(trx, {
                  table: "quoteMakeMethod",
                  companyId,
                  scope: { column: "quoteLineId", value: targetQuoteLineId },
                  rows: quoteMakeMethodInserts.map((insert) => ({
                    parentMaterialId: insert.parentMaterialId!,
                    id: insert.id!,
                    quantityPerParent: insert.quantityPerParent
                  }))
                });
              }
            }
          );

          if (parts.billOfProcess) {
            const quoteOperationInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
              sourceQuoteOperations.data.map((op) => ({
                quoteId: targetQuoteId,
                quoteLineId: targetQuoteLineId,
                quoteMakeMethodId:
                  op.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                    ? targetQuoteMakeMethod.data.id
                    : quoteMakeMethodIdToQuoteMakeMethodId[
                        op.quoteMakeMethodId!
                      ],
                processId: op.processId,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                laborRate: op.laborRate,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                machineRate: op.machineRate,
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                overheadRate: op.overheadRate,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              }));

            if (quoteOperationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                sourceQuoteOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    quoteOperationTool,
                    quoteOperationParameter,
                    quoteOperationStep
                  } = operation;

                  if (
                    parts.tools &&
                    Array.isArray(quoteOperationTool) &&
                    quoteOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
                      .values(
                        quoteOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    parts.parameters &&
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    parts.steps &&
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("quoteOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
                          description: toTiptapDoc(attribute.description),
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      quoteOperationStep,
                      insertedSteps,
                      "quoteOperationStepSlide",
                      "quoteOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          } // end if (parts.billOfProcess)
        });

        await calculateQuoteLinePrices(
          db,
          targetQuoteId,
          targetQuoteLineId,
          companyId,
          userId
        );

        break;
      }

      case "quoteToQuote": {
        const sourceQuoteId = sourceId;
        const asRevision = !!targetId;
        let newQuoteId = "";

        const oldLineToNewLineMap: Record<string, string> = {};

        const [
          sourceQuote,
          sourceQuotePayment,
          sourceQuoteShipment,
          sourceQuoteLines
        ] = await inOrder([
          () => single(db, "quote", { id: sourceQuoteId, companyId }),
          () => single(db, "quotePayment", { id: sourceQuoteId, companyId }),
          () => single(db, "quoteShipment", { id: sourceQuoteId, companyId }),
          () => many(db, "quoteLine", { quoteId: sourceQuoteId, companyId })
        ]);

        if (sourceQuote.error) {
          throw new Error("Failed to get source quote");
        }

        if (sourceQuotePayment.error) {
          throw new Error("Failed to get source quote payment");
        }

        if (sourceQuoteShipment.error) {
          throw new Error("Failed to get source quote shipment");
        }

        const sourceQuoteLinePricing = await many(db, "quoteLinePrice", {
          quoteLineId: sourceQuoteLines.data?.map((l) => l.id) ?? []
        });

        if (sourceQuoteLinePricing.error) {
          throw new Error("Failed to get source quote line pricing");
        }

        await db.transaction().execute(async (trx) => {
          let quoteId: string;
          let revisionId = 0;
          if (asRevision) {
            quoteId = sourceQuote.data?.quoteId ?? "";
            revisionId = await getNextRevisionSequence(
              trx,
              "quote",
              "quoteId",
              quoteId,
              companyId
            );
          } else {
            quoteId = await getNextSequence(trx, "quote", companyId);
          }

          // Each revision needs its own link row (the share page resolves a
          // quote by externalLinkId), but documentId is unique per document —
          // qualify it with the revision so a revision of Q000001 doesn't
          // collide with the original's link.
          //
          // A conflict here can only mean an ORPHAN: revisions are numbered
          // max(revisionId) + 1, so this documentId can't belong to a live
          // quote — the previous holder was deleted and deleteQuote leaves the
          // link row behind. Reuse it rather than failing the whole copy.
          const linkDocumentId =
            revisionId > 0 ? `${quoteId}-${revisionId}` : quoteId;
          const externalLinkId = await trx
            .insertInto("externalLink")
            .values({
              documentId: linkDocumentId,
              documentType: "Quote",
              companyId
            })
            .onConflict((oc) =>
              oc
                .columns(["documentId", "documentType", "companyId"])
                .doUpdateSet({ documentId: linkDocumentId })
            )
            .returning(["id"])
            .executeTakeFirstOrThrow();

          let opportunityId: string | undefined = undefined;
          if (asRevision) {
            opportunityId = sourceQuote.data?.opportunityId ?? undefined;
          } else {
            const opportunity = await trx
              .insertInto("opportunity")
              .values({
                companyId,
                customerId: sourceQuote.data?.customerId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            opportunityId = opportunity.id;
          }

          const quote = await trx
            .insertInto("quote")
            .values([
              {
                quoteId,
                revisionId,
                customerId: sourceQuote.data?.customerId,
                customerContactId: sourceQuote.data?.customerContactId,
                customerLocationId: sourceQuote.data?.customerLocationId,
                customerReference: sourceQuote.data?.customerReference,
                locationId: sourceQuote.data?.locationId,
                expirationDate: datetime
                  .today(await getCompanyTimeZone(trx, companyId))
                  .add({ days: 30 })
                  .toString(),
                salesPersonId: sourceQuote.data?.salesPersonId ?? userId,
                status: "Draft",
                externalNotes: toJson(sourceQuote.data?.externalNotes),
                internalNotes: toJson(sourceQuote.data?.internalNotes),
                currencyCode: sourceQuote.data?.currencyCode,
                exchangeRate: sourceQuote.data?.exchangeRate,
                exchangeRateUpdatedAt: datetime.timestamp(),
                externalLinkId: externalLinkId.id,
                opportunityId,
                companyId,
                createdBy: userId
              }
            ])
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!quote.id) {
            throw new Error("Failed to insert quote");
          }

          newQuoteId = quote.id;

          // Insert quotePayment
          await trx
            .insertInto("quotePayment")
            .values({
              id: quote.id,
              invoiceCustomerId: sourceQuotePayment.data?.invoiceCustomerId,
              invoiceCustomerContactId:
                sourceQuotePayment.data?.invoiceCustomerContactId,
              invoiceCustomerLocationId:
                sourceQuotePayment.data?.invoiceCustomerLocationId,
              paymentTermId: sourceQuotePayment.data?.paymentTermId,
              companyId,
              updatedBy: userId
            })
            .execute();

          // Insert quoteShipment
          await trx
            .insertInto("quoteShipment")
            .values({
              id: quote.id,
              locationId: sourceQuoteShipment.data?.locationId,
              shippingMethodId: sourceQuoteShipment.data?.shippingMethodId,
              shippingTermId: sourceQuoteShipment.data?.shippingTermId,
              shippingCost: sourceQuoteShipment.data?.shippingCost,
              receiptRequestedDate:
                sourceQuoteShipment.data?.receiptRequestedDate,
              companyId,
              updatedBy: userId
            })
            .execute();

          for await (const { id, ...line } of sourceQuoteLines.data ?? []) {
            const newLine = await trx
              .insertInto("quoteLine")
              .values({
                ...line,
                ...toJsonColumns(line, QUOTE_LINE_JSON_COLUMNS),
                quoteId: quote.id,
                companyId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            if (!newLine.id) {
              throw new Error("Failed to insert quote line");
            }

            if (line.methodType === "Make to Order") {
              // we only need further processing on make lines
              oldLineToNewLineMap[id] = newLine.id;
            }

            const sourceQuotePricingForLine =
              sourceQuoteLinePricing.data?.filter(
                (l) => l.quoteLineId === id
              ) ?? [];

            if (sourceQuotePricingForLine.length > 0) {
              await trx
                .insertInto("quoteLinePrice")
                .values(
                  sourceQuotePricingForLine.map((l) => ({
                    quoteId: newQuoteId!,
                    quoteLineId: newLine.id!,
                    companyId,
                    leadTime: l.leadTime ?? 0,
                    discountPercent: l.discountPercent ?? 0,
                    quantity: l.quantity ?? 0,
                    unitPrice: l.unitPrice ?? 0,
                    shippingCost: l.shippingCost ?? 0,
                    // Never 0: a zero rate is not a valid snapshot (DB CHECK
                    // "exchangeRate" > 0) and zeroes every converted* generated
                    // column. A legacy null line rate falls back to the SOURCE
                    // QUOTE's own stamped header rate; 1 only when the source
                    // header predates stamping too (base-consistent with its
                    // line snapshots' old default).
                    exchangeRate:
                      l.exchangeRate ?? sourceQuote.data?.exchangeRate ?? 1,
                    categoryMarkups: JSON.stringify(l.categoryMarkups ?? {}),
                    // Copied prices keep their provenance so a manual price
                    // stays protected on the new quote/revision, and the
                    // trace that explains it.
                    priceSource: l.priceSource ?? "system",
                    priceTrace: toJson(l.priceTrace),
                    createdBy: userId
                  }))
                )
                .execute();
            }
          }
        });

        await db.transaction().execute(async (trx) => {
          for await (const [oldLineId, newLineId] of Object.entries(
            oldLineToNewLineMap
          )) {
            const [
              targetQuoteMakeMethod,
              sourceQuoteMakeMethod,
              sourceQuoteMaterials,
              sourceQuoteOperations
            ] = await Promise.all([
              single(trx, "quoteMakeMethod", {
                parentMaterialId: isNull,
                quoteLineId: newLineId,
                companyId
              }),
              single(trx, "quoteMakeMethod", {
                parentMaterialId: isNull,
                quoteLineId: oldLineId,
                companyId
              }),
              many(trx, "quoteMaterial", { quoteLineId: oldLineId, companyId }),
              many<
                "quoteOperation",
                Tables["quoteOperation"]["Row"] & {
                  quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
                  quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
                  quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
                }
              >(
                trx,
                "quoteOperation",
                { quoteLineId: oldLineId, companyId },
                {
                  embed: {
                    quoteOperationTool: {
                      table: "quoteOperationTool",
                      on: "operationId"
                    },
                    quoteOperationParameter: {
                      table: "quoteOperationParameter",
                      on: "operationId"
                    },
                    quoteOperationStep: {
                      table: "quoteOperationStep",
                      on: "operationId"
                    }
                  }
                }
              )
            ]);

            if (targetQuoteMakeMethod.error) {
              logger.error("Failed to get target quote make method", {
                error: targetQuoteMakeMethod.error
              });
              throw new Error("Failed to get target quote make method");
            }

            if (
              sourceQuoteMakeMethod.error ||
              sourceQuoteMaterials.error ||
              sourceQuoteOperations.error
            ) {
              throw new Error("Failed to source quote data");
            }

            const [quoteMethodTrees] = await Promise.all([
              getQuoteMethodTree(trx, sourceQuoteMakeMethod.data.id)
            ]);

            if (quoteMethodTrees.error) {
              throw new Error("Failed to get method tree");
            }

            const quoteMethodTree = quoteMethodTrees
              .data?.[0] as QuoteMethodTreeItem;
            if (!quoteMethodTree)
              throw new NotFoundError("Method tree not found");

            const quoteMaterialIdToQuoteMaterialId: Record<string, string> = {};
            const quoteMakeMethodIdToQuoteMakeMethodId: Record<string, string> =
              {};

            await traverseQuoteMethod(
              quoteMethodTree,
              async (node: QuoteMethodTreeItem) => {
                const quoteMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
                  [];
                const quoteMakeMethodInserts: Database["public"]["Tables"]["quoteMakeMethod"]["Insert"][] =
                  [];

                for await (const child of node.children) {
                  // A zero-quantity Buy/Pick line is dropped from the new quote.
                  // A made sub-assembly is left intact even at quantity 0: its
                  // operations are copied by make method below and would reference
                  // a make method that never got created if the row were removed.
                  if (
                    isZeroQuantity(child.data.quantity) &&
                    child.data.methodType !== "Make to Order"
                  ) {
                    continue;
                  }
                  const newMaterialId = nanoid();
                  quoteMaterialIdToQuoteMaterialId[child.id] = newMaterialId;

                  quoteMaterialInserts.push({
                    id: newMaterialId,
                    quoteId: newQuoteId,
                    quoteLineId: newLineId,
                    itemId: child.data.itemId,
                    kit: child.data.kit,
                    itemType: child.data.itemType,
                    methodType: child.data.methodType,
                    order: child.data.order,
                    description: child.data.description,
                    quoteMakeMethodId:
                      child.data.quoteMakeMethodId ===
                      sourceQuoteMakeMethod.data.id
                        ? targetQuoteMakeMethod.data.id
                        : quoteMakeMethodIdToQuoteMakeMethodId[
                            child.data.quoteMakeMethodId
                          ]!,
                    quantity: child.data.quantity,
                    storageUnitId: child.data.storageUnitId,
                    unitCost: child.data.unitCost ?? 0, // TODO: get real unit cost
                    unitCostSource: child.data.unitCostSource ?? "system",
                    unitOfMeasureCode: child.data.unitOfMeasureCode,
                    companyId,
                    createdBy: userId,
                    customFields: {}
                  });

                  if (child.data.quoteMaterialMakeMethodId) {
                    const newMakeMethodId = nanoid();
                    quoteMakeMethodIdToQuoteMakeMethodId[
                      child.data.quoteMaterialMakeMethodId
                    ] = newMakeMethodId;
                    quoteMakeMethodInserts.push({
                      id: newMakeMethodId,
                      quoteId: newQuoteId,
                      quoteLineId: newLineId,
                      parentMaterialId:
                        quoteMaterialIdToQuoteMaterialId[child.id],
                      itemId: child.data.itemId,
                      quantityPerParent: child.data.quantity,
                      companyId,
                      createdBy: userId
                    });
                  }
                }

                if (quoteMaterialInserts.length > 0) {
                  await trx
                    .insertInto("quoteMaterial")
                    .values(quoteMaterialInserts)
                    .execute();
                }

                if (quoteMakeMethodInserts.length > 0) {
                  await renameMakeMethods(trx, {
                    table: "quoteMakeMethod",
                    companyId,
                    scope: { column: "quoteLineId", value: newLineId },
                    rows: quoteMakeMethodInserts.map((insert) => ({
                      parentMaterialId: insert.parentMaterialId!,
                      id: insert.id!,
                      quantityPerParent: insert.quantityPerParent
                    }))
                  });
                }
              }
            );

            const quoteOperationInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
              sourceQuoteOperations.data.map((op) => ({
                quoteId: newQuoteId,
                quoteLineId: newLineId,
                quoteMakeMethodId:
                  op.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                    ? targetQuoteMakeMethod.data.id
                    : quoteMakeMethodIdToQuoteMakeMethodId[
                        op.quoteMakeMethodId!
                      ],
                processId: op.processId,
                procedureId: op.procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                laborRate: op.laborRate,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                machineRate: op.machineRate,
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                operationSupplierProcessId: op.operationSupplierProcessId,
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                overheadRate: op.overheadRate,
                tags: op.tags ?? [],
                workInstruction: toJson(op.workInstruction),
                companyId,
                createdBy: userId,
                customFields: {}
              }));

            if (quoteOperationInserts.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                sourceQuoteOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;
                if (operationId) {
                  const {
                    quoteOperationTool,
                    quoteOperationParameter,
                    quoteOperationStep
                  } = operation;

                  if (
                    Array.isArray(quoteOperationTool) &&
                    quoteOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
                      .values(
                        quoteOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("quoteOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
                          description: toTiptapDoc(attribute.description),
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      quoteOperationStep,
                      insertedSteps,
                      "quoteOperationStepSlide",
                      "quoteOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          }
        });
        if (newQuoteId) {
          return { success: true, newQuoteId } as GetMethodResult;
        }
        break;
      }
      default:
        throw new Error(`Invalid type  ${type}`);
    }

    return { success: true };
  }
});

type Method =
  Database["public"]["Functions"]["get_method_tree"]["Returns"][number];
type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

/** A make method's tree, read on the caller's connection (`db`, or `trx`). */
export async function getMethodTree(
  db: Kysely<KyselyDatabase>,
  makeMethodId: string
): Promise<{ data: MethodTreeItem[]; error: null }> {
  const { rows } = await sql<Method>`
    SELECT * FROM get_method_tree(${makeMethodId})
  `.execute(db);
  return { data: getMethodTreeArrayToTree(rows), error: null };
}

// Build date for a job's supersession / effectivity decisions: prefer the planned
// start, fall back to the due date, then to today. Used wherever the method tree is
// instantiated so swaps and BOM-line effectivity are evaluated as-of the same day.
function jobBuildDate(
  job: { startDate?: string | null; dueDate?: string | null } | null | undefined
): string {
  return (
    job?.startDate ?? job?.dueDate ?? new Date().toISOString().slice(0, 10)
  );
}

// Load every supersession for the company and collapse it into the redirect map
// (chain-collapsed, mode-gated, conversion-factored) as-of the job's build date.
// Every *-ToJob path needs the same map, so this is the single load point.
async function loadSupersessionRedirect(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  job:
    | {
        locationId?: string | null;
        startDate?: string | null;
        dueDate?: string | null;
      }
    | null
    | undefined
): Promise<SupersessionContext> {
  // Read over the direct connection: no row cap to page around (PostgREST stops
  // at 1000 rows, which is why this used to page), and a fraction of the
  // latency. MRP reads the same table in full, so both redirect every rule.
  //
  // A failure throws, like every other read in this function. An empty map is
  // indistinguishable from "this company supersedes nothing", so swallowing an
  // error would build a real work order out of retired parts and report
  // success.
  let rows: SupersessionRow[] = await db
    .selectFrom("itemSupersession")
    .select([
      "itemId",
      "supersessionMode",
      "successorItemId",
      "successorEffectivityDate",
      "conversionFactor"
    ])
    .where("companyId", "=", companyId)
    .orderBy("itemId")
    .execute();

  const consumeFirstItemIds = rows
    .filter((r) => r.supersessionMode === "Consume First")
    .map((r) => r.itemId);
  const consumeFirstOnHand = new Map<string, number>();
  if (consumeFirstItemIds.length > 0 && job?.locationId) {
    const stock = await db
      .selectFrom("itemStockQuantities")
      .select(["itemId", "quantityOnHand"])
      .where("companyId", "=", companyId)
      .where("locationId", "=", job.locationId)
      .where("itemId", "in", consumeFirstItemIds)
      .execute();
    const items = await db
      .selectFrom("item")
      .select(["id", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", consumeFirstItemIds)
      .execute();
    const onHandByItem = new Map<string, number>();
    for (const r of stock) {
      onHandByItem.set(
        r.itemId,
        (onHandByItem.get(r.itemId) ?? 0) + Number(r.quantityOnHand ?? 0)
      );
    }
    const madeItemIds = new Set(
      items
        .filter(
          (i) =>
            effectiveReplenishment(i.replenishmentSystem ?? undefined) ===
            "Make"
        )
        .map((i) => i.id)
    );
    for (const id of madeItemIds) {
      consumeFirstOnHand.set(id, onHandByItem.get(id) ?? 0);
    }
    rows = withoutStockedConsumeFirst(
      rows,
      new Set(
        [...onHandByItem]
          .filter(([id, onHand]) => onHand > 0 && !madeItemIds.has(id))
          .map(([id]) => id)
      )
    );
  }

  const redirect = buildSupersessionRedirectMap(rows, jobBuildDate(job));
  const consumeFirstHops = buildConsumeFirstHops(rows, jobBuildDate(job));
  for (const id of [...consumeFirstOnHand.keys()]) {
    if (!redirect.has(id)) consumeFirstOnHand.delete(id);
  }
  const boughtSuccessors = new Set<string>();
  const successorIds = [...new Set([...redirect.values()].map((r) => r.to))];
  if (successorIds.length > 0) {
    const successors = await db
      .selectFrom("item")
      .select(["id", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", successorIds)
      .execute();
    for (const i of successors) {
      if (
        effectiveReplenishment(i.replenishmentSystem ?? undefined) !== "Make"
      ) {
        boughtSuccessors.add(i.id);
      }
    }
  }
  return { redirect, consumeFirstOnHand, consumeFirstHops, boughtSuccessors };
}

// EVERY jobMaterial field that is a function of WHICH ITEM the row is for, in
// one place. A supersession swap has to restate all of them, and the way that
// goes wrong is a hand-written field list that drifts: `itemScrapPercentage` was
// simply absent from the swap's `.set({...})`, so a swapped line costed the
// predecessor's scrap forever. Returning them as an object the caller SPREADS
// means a field added here reaches the swap without a second edit — the list
// cannot fall out of sync with itself.
//
// Quantities are deliberately NOT here: they depend on the parent's cascade and
// the method type, which this function has no view of. It returns the scrap RATE
// and lets the caller derive the allowance.
async function itemDerivedJobMaterialFields(opts: {
  trx: Transaction<KyselyDatabase>;
  companyId: string;
  itemId: string;
  locationId: string;
  /** An explicit bin on the BOM line still wins over the item's default. */
  lineStorageUnitId?: string;
}) {
  const { trx, companyId, itemId, locationId, lineStorageUnitId } = opts;

  const [item, replenishment, storageUnitId] = await Promise.all([
    readItemWithCost(trx, itemId, companyId),
    trx
      .selectFrom("itemReplenishment")
      .select("scrapPercentage")
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    getStorageUnitId(trx, itemId, locationId, lineStorageUnitId)
  ]);

  if (!item) return null;

  return {
    itemId,
    itemType: item.type,
    description: item.name,
    unitCost: item.itemCost?.[0]?.unitCost ?? 0,
    requiresSerialTracking: item.itemTrackingType === "Serial",
    requiresBatchTracking: item.itemTrackingType === "Batch",
    itemScrapPercentage: Number(replenishment?.scrapPercentage ?? 0),
    storageUnitId
  };
}

// Made-component supersession at job creation: if a made child has an effective
// successor that is ITSELF a made item, repoint the job material at the successor
// and explode the SUCCESSOR's method (date-pruned) instead of the old part's,
// scaling the cascade by the conversion factor. A Make -> Buy successor is a
// structural flip we leave on the old part (handled elsewhere). Returns true when
// the swap was applied, so the caller can skip the default traversal.
async function swapMadeSubAssembly(opts: {
  trx: Transaction<KyselyDatabase>;
  companyId: string;
  child: MethodTreeItem;
  material:
    | {
        quantity?: number | null;
        estimatedQuantity?: number | null;
        scrapQuantity?: number | null;
      }
    | undefined;
  materialId: string;
  /** The job's location — the successor's default bin is resolved against it. */
  locationId: string;
  supersessionRedirect: Map<string, { to: string; factor: number }>;
  newMakeMethodId: string;
  traverseMethod: (
    node: MethodTreeItem,
    parentJobMakeMethodId: string | null,
    parentEstimatedQuantity: number
  ) => Promise<unknown>;
}): Promise<boolean> {
  const {
    trx,
    companyId,
    child,
    material,
    materialId,
    locationId,
    supersessionRedirect,
    newMakeMethodId,
    traverseMethod
  } = opts;

  const madeRedirect = supersessionRedirect.get(child.data.itemId);
  if (!madeRedirect) return false;

  const successorMakeMethod = await trx
    .selectFrom("activeMakeMethods")
    .select(["id"])
    .where("itemId", "=", madeRedirect.to)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!successorMakeMethod?.id) return false;

  // Every item-dependent field, restated for the successor in ONE step. Spread,
  // never hand-listed: this row is being repointed at a different item, so all
  // of them change together, and a field added to the helper arrives here
  // automatically. `itemScrapPercentage` going missing from a hand-written list
  // is exactly how a swapped line ended up costing the predecessor's scrap.
  const itemFields = await itemDerivedJobMaterialFields({
    trx,
    companyId,
    itemId: madeRedirect.to,
    locationId,
    // @ts-ignore: storageUnitIds is a dynamic field
    lineStorageUnitId: child.data.storageUnitIds?.[locationId] ?? undefined
  });
  if (!itemFields) return false;

  // Quantities are the caller's business, not the helper's — they depend on the
  // cascade and the method type. Make to Order: estimatedQuantity is the GOOD
  // quantity, scrap excluded, and target + scrap is what children explode
  // against. Deriving both from the SAME scrap rate is what stops the row and
  // its sub-tree disagreeing.
  const targetQuantity =
    (material?.estimatedQuantity ?? 0) * madeRedirect.factor;
  const scrapQuantity = scrapAllowance(
    targetQuantity,
    itemFields.itemScrapPercentage
  );
  const totalWithScrap = targetQuantity + scrapQuantity;

  await trx
    .updateTable("jobMaterial")
    .set({
      ...itemFields,
      quantity: (material?.quantity ?? 0) * madeRedirect.factor,
      estimatedQuantity: targetQuantity,
      scrapQuantity,
      substitutedFromItemId: child.data.itemId,
      substitutionFactor: madeRedirect.factor
    })
    .where("id", "=", materialId)
    .where("companyId", "=", companyId)
    .execute();

  const successorTree = await getMethodTree(trx, successorMakeMethod.id);
  const successorRoot = successorTree.data?.[0];
  if (successorRoot) {
    // The SAME total the row above was written with — not the predecessor's,
    // rescaled. `|| 1` mirrors the unswapped path's fallback exactly; the old
    // `(childTotalForCascade || 1) * factor` yielded `factor` for a zero total
    // where the unswapped path yields 1.
    await traverseMethod(successorRoot, newMakeMethodId, totalWithScrap || 1);
  }
  return true;
}

async function settleConsumeFirstLines(opts: {
  trx: Transaction<KyselyDatabase>;
  companyId: string;
  jobId: string;
  jobMaterialIds: string[];
  locationId: string | null | undefined;
  asOfDate: string;
}) {
  const { trx, companyId, jobId, jobMaterialIds, locationId, asOfDate } = opts;
  if (!locationId || jobMaterialIds.length === 0) return;

  const rules = await trx
    .selectFrom("itemSupersession")
    .select([
      "itemId",
      "successorItemId",
      "successorEffectivityDate",
      "conversionFactor"
    ])
    .where("companyId", "=", companyId)
    .where("supersessionMode", "=", "Consume First")
    .where("successorItemId", "is not", null)
    .orderBy("itemId")
    .execute();
  const consumeFirstRules = buildConsumeFirstRules(rules, asOfDate);
  const { successorByPredecessor, predecessorsBySuccessor } = consumeFirstRules;
  if (successorByPredecessor.size === 0) return;

  const materials = await trx
    .selectFrom("jobMaterial")
    .select([
      "id",
      "itemId",
      "quantity",
      "estimatedQuantity",
      "scrapQuantity",
      "substitutedFromItemId",
      "substitutionFactor"
    ])
    .where("jobId", "=", jobId)
    .where("companyId", "=", companyId)
    .where("id", "in", jobMaterialIds)
    .where("methodType", "!=", "Make to Order")
    .where((eb) =>
      eb.or([eb("quantityIssued", "is", null), eb("quantityIssued", "<=", 0)])
    )
    .where("itemId", "in", [
      ...new Set([
        ...successorByPredecessor.keys(),
        ...predecessorsBySuccessor.keys()
      ])
    ])
    .execute();
  if (materials.length === 0) return;

  const predecessorIds = new Set<string>();
  for (const m of materials) {
    for (const id of consumeFirstStockItems(m, consumeFirstRules)) {
      predecessorIds.add(id);
    }
  }
  const stock = await trx
    .selectFrom("itemStockQuantities")
    .select(["itemId", "quantityOnHand"])
    .where("companyId", "=", companyId)
    .where("locationId", "=", locationId)
    .where("itemId", "in", [...predecessorIds])
    .execute();
  const onHandByItem = new Map<string, number>();
  for (const row of stock) {
    onHandByItem.set(
      row.itemId,
      (onHandByItem.get(row.itemId) ?? 0) + Number(row.quantityOnHand ?? 0)
    );
  }

  const swapLine = async (
    m: (typeof materials)[number],
    toItemId: string,
    factor: number,
    provenance: {
      substitutedFromItemId: string | null;
      substitutionFactor: number | null;
    }
  ) => {
    const fields = await itemDerivedJobMaterialFields({
      trx,
      companyId,
      itemId: toItemId,
      locationId
    });
    if (!fields) return;
    const quantities = pullBackQuantities(
      m,
      factor,
      fields.itemScrapPercentage
    );
    await trx
      .updateTable("jobMaterial")
      .set({
        ...fields,
        ...quantities,
        ...provenance
      })
      .where("id", "=", m.id)
      .where("companyId", "=", companyId)
      .execute();
  };

  materials.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of materials) {
    const settlement = settleConsumeFirstLine(
      m,
      consumeFirstRules,
      onHandByItem
    );
    reserveConsumeFirstStock(m, settlement, consumeFirstRules, onHandByItem);
    if (!settlement) continue;
    await swapLine(
      m,
      settlement.toItemId,
      settlement.factor,
      settlement.kind === "revert"
        ? { substitutedFromItemId: null, substitutionFactor: null }
        : {
            substitutedFromItemId: m.itemId,
            substitutionFactor: settlement.factor
          }
    );
  }
}

// Shared by every *-ToJob path. For a Buy/Pick job-material row whose item has an
// effective supersession successor (per the redirect map), returns the successor's
// item fields so the row points at the right part with consistent tracking / type /
// cost. Make-to-Order lines are never swapped here (the successor's own sub-method
// would need re-exploding — a later layer), so the caller passes only Buy/Pick rows
// or this returns null for them. The line's unit of measure and methodType are
// intentionally preserved — the conversion factor translates the quantity.
async function resolveJobMaterialSupersession(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  redirect: Map<string, { to: string; factor: number }>,
  line: { itemId: string; methodType: string }
): Promise<{
  itemId: string;
  factor: number;
  substitutedFromItemId: string;
  itemType: string;
  description: string;
  unitCost: number | null;
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
} | null> {
  if (line.methodType === "Make to Order") return null;
  const r = redirect.get(line.itemId);
  if (!r) return null;
  const successor = await readItemWithCost(db, r.to, companyId);
  if (!successor) return null;
  return {
    itemId: r.to,
    factor: r.factor,
    substitutedFromItemId: line.itemId,
    itemType: successor.type,
    description: successor.name,
    unitCost: successor.itemCost?.[0]?.unitCost ?? null,
    requiresSerialTracking: successor.itemTrackingType === "Serial",
    requiresBatchTracking: successor.itemTrackingType === "Batch"
  };
}

function getMethodTreeArrayToTree(items: Method[]): MethodTreeItem[] {
  function traverseAndRenameIds(node: MethodTreeItem) {
    const clone = structuredClone(node);
    clone.id = nanoid(20);
    clone.children = clone.children.map((n) => traverseAndRenameIds(n));
    return clone;
  }

  const rootItems: MethodTreeItem[] = [];
  const lookup: { [id: string]: MethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore - we add data on the next line
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId]!["data"] = item;

    const treeItem = lookup[itemId]!;

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore - we don't add data here
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]!["children"].push(treeItem);
    }
  }

  return rootItems.map((item) => traverseAndRenameIds(item));
}

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

/** A method operation with its tools (and their step links), parameters and steps. */
type MethodOperationRow = Tables["methodOperation"]["Row"] & {
  methodOperationTool: (Tables["methodOperationTool"]["Row"] & {
    methodOperationToolStep: Tables["methodOperationToolStep"]["Row"][];
  })[];
  methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
  methodOperationStep: Tables["methodOperationStep"]["Row"][];
};

// makeMethodId is globally unique (makeMethod's PK is "id" alone), so the
// companyId filter cannot drop a legitimate row — it only closes a
// cross-tenant read.
function readMethodOperations(
  db: Kysely<KyselyDatabase>,
  makeMethodIds: string[],
  companyId: string
) {
  return selectRows<"methodOperation", MethodOperationRow>(
    db,
    "methodOperation",
    { makeMethodId: makeMethodIds, companyId },
    {
      orderBy: ["order", "id"],
      embed: {
        methodOperationTool: {
          table: "methodOperationTool",
          on: "operationId",
          embed: {
            methodOperationToolStep: {
              table: "methodOperationToolStep",
              on: "methodOperationToolId"
            }
          }
        },
        methodOperationParameter: {
          table: "methodOperationParameter",
          on: "operationId"
        },
        methodOperationStep: { table: "methodOperationStep", on: "operationId" }
      }
    }
  );
}

/** A quote operation with its tools, parameters and steps. */
type QuoteOperationWithDetails = Tables["quoteOperation"]["Row"] & {
  quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
  quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
  quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
};

const quoteOperationDetails = {
  quoteOperationTool: { table: "quoteOperationTool", on: "operationId" },
  quoteOperationParameter: {
    table: "quoteOperationParameter",
    on: "operationId"
  },
  quoteOperationStep: { table: "quoteOperationStep", on: "operationId" }
} as const;

/** Every item a method tree names, plus the successor each would be swapped for. */
function treeItemIds(
  root: { data: { itemId: string }; children: unknown[] },
  redirect?: Map<string, { to: string }>
): string[] {
  const ids: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: { data: { itemId: string }; children: unknown[] }) => {
    if (seen.has(node)) return;
    seen.add(node);
    ids.push(node.data.itemId);
    const successor = redirect?.get(node.data.itemId)?.to;
    if (successor) ids.push(successor);
    for (const child of node.children) walk(child as typeof node);
  };
  walk(root);
  return ids;
}

/**
 * An item's scrap percentage and its default bin at one location, read for
 * many items at once and remembered for the request. The copy flows asked for
 * these one material at a time inside their transaction — three statements
 * per material, 110 of the 164 a 40-line job copy sent.
 *
 * `load` the tree's items up front; an item it did not cover (a successor a
 * swap lands on) is read when first asked for, so nothing resolves to a
 * silent 0 or a missing bin.
 */
function createItemDefaults(
  companyId: string,
  locationId: string | null | undefined
) {
  const scrapByItemId = new Map<string, number>();
  const binByItemId = new Map<string, string>();
  const loaded = new Set<string>();

  async function load(
    reader: Kysely<KyselyDatabase>,
    itemIds: (string | null | undefined)[]
  ) {
    const missing = [...new Set(itemIds)].filter(
      (id): id is string => !!id && !loaded.has(id)
    );
    if (missing.length === 0) return;

    const replenishments = await reader
      .selectFrom("itemReplenishment")
      .select(["itemId", "scrapPercentage"])
      .where("itemId", "in", missing)
      .where("companyId", "=", companyId)
      .execute();
    for (const row of replenishments) {
      scrapByItemId.set(row.itemId, Number(row.scrapPercentage ?? 0));
    }

    // The pick method's default bin wins, else the bin holding the most.
    if (locationId) {
      const ledgerTotals = await reader
        .selectFrom("itemLedger")
        .where("locationId", "=", locationId)
        .where("companyId", "=", companyId)
        .where("itemId", "in", missing)
        .where("storageUnitId", "is not", null)
        .groupBy(["itemId", "storageUnitId"])
        .select([
          "itemId",
          "storageUnitId",
          (eb) => eb.fn.sum("quantity").as("totalQuantity")
        ])
        .having((eb) => eb.fn.sum("quantity"), ">", 0)
        .orderBy("itemId")
        .orderBy("totalQuantity", "desc")
        .orderBy("storageUnitId")
        .execute();
      for (const row of ledgerTotals) {
        // Ordered by quantity: the first row for an item is its fullest bin.
        if (row.storageUnitId && !binByItemId.has(row.itemId)) {
          binByItemId.set(row.itemId, row.storageUnitId);
        }
      }

      const pickMethods = await reader
        .selectFrom("pickMethod")
        .select(["itemId", "defaultStorageUnitId"])
        .where("locationId", "=", locationId)
        .where("companyId", "=", companyId)
        .where("itemId", "in", missing)
        .where("defaultStorageUnitId", "is not", null)
        .execute();
      for (const pickMethod of pickMethods) {
        if (pickMethod.defaultStorageUnitId) {
          binByItemId.set(pickMethod.itemId, pickMethod.defaultStorageUnitId);
        }
      }
    }

    // Marked only after the rows land, so an item never reads as "loaded, no
    // row" while its read is still in flight.
    for (const id of missing) loaded.add(id);
  }

  return {
    load,
    async scrapPercentage(reader: Kysely<KyselyDatabase>, itemId: string) {
      await load(reader, [itemId]);
      return scrapByItemId.get(itemId) ?? 0;
    },
    /** An explicit bin on the line wins over the item's default. */
    async storageUnitId(
      reader: Kysely<KyselyDatabase>,
      itemId: string,
      lineStorageUnitId?: string | null
    ) {
      if (lineStorageUnitId) return lineStorageUnitId;
      await load(reader, [itemId]);
      return binByItemId.get(itemId);
    }
  };
}

/** An item with its cost row, as the job-material mappers read it. */
function readItemWithCost(
  db: Kysely<KyselyDatabase>,
  itemId: string,
  companyId: string
) {
  return selectRow<
    "item",
    Tables["item"]["Row"] & { itemCost: Tables["itemCost"]["Row"][] }
  >(
    db,
    "item",
    { id: itemId, companyId },
    { embed: { itemCost: { table: "itemCost", on: "itemId" } } }
  );
}

function getFieldKey(field: string, id: string) {
  return `${field}:${id}`;
}

type ProcedureForJob = {
  content: unknown;
  steps: Record<string, unknown>[];
  parameters: Record<string, unknown>[];
};

// One read per procedure per transaction, however many operations use it.
const procedureCacheByTransaction = new WeakMap<
  object,
  Map<string, Promise<ProcedureForJob | undefined>>
>();

function readProcedureForJob(
  trx: Transaction<KyselyDatabase>,
  procedureId: string,
  companyId: string
) {
  let cache = procedureCacheByTransaction.get(trx);
  if (!cache) {
    cache = new Map();
    procedureCacheByTransaction.set(trx, cache);
  }
  let procedure = cache.get(procedureId);
  if (!procedure) {
    procedure = sql<ProcedureForJob>`
      SELECT p."content",
        (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
           FROM "procedureStep" s WHERE s."procedureId" = p."id") AS "steps",
        (SELECT coalesce(jsonb_agg(to_jsonb(pp)), '[]'::jsonb)
           FROM "procedureParameter" pp WHERE pp."procedureId" = p."id") AS "parameters"
      FROM "procedure" p
      WHERE p."id" = ${procedureId} AND p."companyId" = ${companyId}
    `
      .execute(trx)
      .then((result) => result.rows[0]);
    cache.set(procedureId, procedure);
  }
  return procedure;
}

async function insertProcedureDataForJobOperation(
  trx: Transaction<KyselyDatabase>,
  args: {
    operationId: string;
    procedureId: string;
    companyId: string;
    userId: string;
  }
) {
  const { operationId, procedureId, companyId, userId } = args;
  const procedure = await readProcedureForJob(trx, procedureId, companyId);
  if (!procedure) return;

  const copy = (row: Record<string, unknown>) => {
    const {
      id: _id,
      procedureId: _procedureId,
      createdAt: _createdAt,
      ...rest
    } = row;
    return { ...rest, operationId, companyId, createdBy: userId };
  };
  const steps = procedure.steps.map((step) => ({
    ...copy(step),
    description: toTiptapDoc(step.description as never)
  }));
  const parameters = procedure.parameters.map(copy);

  // The steps, parameters and work instruction go in one statement: each
  // data-modifying CTE runs once, whether or not the outer UPDATE reads it.
  let write: QueryCreator<KyselyDatabase> = trx;
  if (steps.length > 0) {
    write = write.with("steps", (db) =>
      db.insertInto("jobOperationStep").values(steps as never)
    ) as unknown as QueryCreator<KyselyDatabase>;
  }
  if (parameters.length > 0) {
    write = write.with("parameters", (db) =>
      db.insertInto("jobOperationParameter").values(parameters as never)
    ) as unknown as QueryCreator<KyselyDatabase>;
  }
  await write
    .updateTable("jobOperation")
    .set({ workInstruction: toJson(procedure.content ?? {}) })
    .where("id", "=", operationId)
    .where("companyId", "=", companyId)
    .execute();
}

type TreeOperation = Tables["methodOperation"]["Row"] & {
  methodOperationTool: Tables["methodOperationTool"]["Row"][];
  methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
  methodOperationStep: Tables["methodOperationStep"]["Row"][];
};

/** Every node's method operations, read in one query instead of one per node. */
async function readOperationsForTree(
  trx: Transaction<KyselyDatabase>,
  root: MethodTreeItem
) {
  const makeMethodIds = new Set<string>();
  const walk = (node: MethodTreeItem) => {
    if (node.data.materialMakeMethodId)
      makeMethodIds.add(node.data.materialMakeMethodId);
    node.children.forEach(walk);
  };
  walk(root);
  const operations = await many<"methodOperation", TreeOperation>(
    trx,
    "methodOperation",
    { makeMethodId: [...makeMethodIds] },
    {
      embed: {
        methodOperationTool: {
          table: "methodOperationTool",
          on: "operationId"
        },
        methodOperationParameter: {
          table: "methodOperationParameter",
          on: "operationId"
        },
        methodOperationStep: { table: "methodOperationStep", on: "operationId" }
      }
    }
  );
  const byMakeMethodId = new Map<string, TreeOperation[]>();
  for (const operation of operations.data) {
    const list = byMakeMethodId.get(operation.makeMethodId);
    if (list) list.push(operation);
    else byMakeMethodId.set(operation.makeMethodId, [operation]);
  }
  return byMakeMethodId;
}

async function insertDeferredJobMaterials(
  trx: Transaction<KyselyDatabase>,
  materials: Database["public"]["Tables"]["jobMaterial"]["Insert"][],
  steps: Database["public"]["Tables"]["jobMaterialStep"]["Insert"][]
) {
  // Chunked: a whole tree in one statement can pass Postgres' 65535 bind
  // parameters.
  for (const chunk of chunked(materials)) {
    await trx.insertInto("jobMaterial").values(chunk).execute();
  }
  for (const chunk of chunked(steps)) {
    await trx.insertInto("jobMaterialStep").values(chunk).execute();
  }
}

/**
 * Gives the make-method rows that the jobMaterial / quoteMaterial insert
 * trigger created their planned ids, for every made material of an insert in
 * ONE statement.
 */
async function renameMakeMethods(
  trx: Transaction<KyselyDatabase>,
  args: {
    table: "jobMakeMethod" | "quoteMakeMethod";
    companyId: string;
    /** Narrows the match to one job or quote line, as the loops this replaced did. */
    scope?: { column: "jobId" | "quoteLineId"; value: string };
    /** Left unchanged where undefined, as `.set()` would. */
    rows: {
      parentMaterialId: string;
      id: string;
      quantityPerParent?: number | null;
    }[];
  }
) {
  const { table, companyId, scope } = args;
  for (const rows of chunked(args.rows)) {
    await renameMakeMethodChunk(trx, { table, companyId, scope, rows });
  }
}

async function renameMakeMethodChunk(
  trx: Transaction<KyselyDatabase>,
  args: Parameters<typeof renameMakeMethods>[1]
) {
  const { table, companyId, scope, rows } = args;
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${row.parentMaterialId}::text, ${row.id}::text, ${row.quantityPerParent ?? null}::numeric, ${row.quantityPerParent !== undefined}::boolean)`
    )
  );
  await sql`
    UPDATE ${sql.table(table)} AS t
    SET "id" = v."id",
      "quantityPerParent" = CASE WHEN v."setQuantity" THEN v."quantityPerParent" ELSE t."quantityPerParent" END
    FROM (VALUES ${values}) AS v("parentMaterialId", "id", "quantityPerParent", "setQuantity")
    WHERE t."parentMaterialId" = v."parentMaterialId"
      AND t."companyId" = ${companyId}
      ${scope ? sql`AND t.${sql.ref(scope.column)} = ${scope.value}` : sql``}
  `.execute(trx);
}

// Assembly analog of insertProcedureDataForJobOperation: an Assembly operation
// inherits its steps from the linked assembly instruction at job-creation time
// (the method/quote only carry the pointer). Mirrors the payload of
// syncAssemblyInstructionToOperation (production.service.ts) — including the
// assemblyInstructionStepId provenance marker, so the job-side re-sync
// reconciles these rows instead of duplicating them — and attaches the
// instruction's 3D model as a model slide on every step.
// Material ↔ step links are flushed separately by
// linkAssemblyStepMaterialsForJobOperations AFTER the direction's jobMaterial
// rows exist (operations are inserted before materials in every direction).
async function insertAssemblyDataForJobOperation(
  trx: Transaction<KyselyDatabase>,
  args: {
    operationId: string;
    assemblyInstructionId: string;
    companyId: string;
    userId: string;
  }
) {
  const { operationId, assemblyInstructionId, companyId, userId } = args;
  const instruction = await selectRow<
    "assemblyInstruction",
    Tables["assemblyInstruction"]["Row"] & {
      assemblyInstructionStep: Tables["assemblyInstructionStep"]["Row"][];
    }
  >(
    trx,
    "assemblyInstruction",
    { id: assemblyInstructionId, companyId },
    {
      embed: {
        assemblyInstructionStep: {
          table: "assemblyInstructionStep",
          on: "assemblyInstructionId"
        }
      }
    }
  );

  if (!instruction) return new Set<string>();

  // A sub-assembly (header) row is not a build action, so it never becomes a
  // job step; its member steps are copied in play order like any other.
  const sourceSteps = (instruction.assemblyInstructionStep ?? [])
    .filter((step) => !step.isSubAssembly)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (sourceSteps.length === 0) return new Set<string>();

  const sourceStepIds = sourceSteps.map((step) => step.id);
  const sourceSlides = await selectRows(
    trx,
    "assemblyInstructionStepSlide",
    { stepId: sourceStepIds, companyId },
    { orderBy: ["sortOrder"] }
  );
  const sourceTools = await selectRows(trx, "assemblyInstructionStepTool", {
    stepId: sourceStepIds,
    companyId
  });
  const slidesByStep = new Map<string, typeof sourceSlides>();
  for (const slide of sourceSlides) {
    const list = slidesByStep.get(slide.stepId) ?? [];
    list.push(slide);
    slidesByStep.set(slide.stepId, list);
  }
  const toolsByStep = new Map<string, { itemId: string; quantity: number }[]>();
  for (const tool of sourceTools) {
    const list = toolsByStep.get(tool.stepId) ?? [];
    list.push({ itemId: tool.itemId, quantity: tool.quantity ?? 1 });
    toolsByStep.set(tool.stepId, list);
  }

  // The operation's own steps (its procedure's, inserted before this) number
  // from 1 as well: the instruction's steps follow them, or the two interleave.
  const ownSteps = await trx
    .selectFrom("jobOperationStep")
    .select((eb) => eb.fn.max("sortOrder").as("lastSortOrder"))
    .where("operationId", "=", operationId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const firstSortOrder = Number(ownSteps?.lastSortOrder ?? 0) + 1;

  // Correlate inserted job steps back to their source steps via the provenance
  // column, not row order.
  const insertedSteps = await trx
    .insertInto("jobOperationStep")
    .values(
      sourceSteps.map((source, index) => ({
        operationId,
        name: source.title || `Step ${index + 1}`,
        type: source.type ?? "Task",
        description: toTiptapDoc(source.description ?? source.instructionText),
        required: source.required ?? false,
        unitOfMeasureCode: source.unitOfMeasureCode,
        minValue: source.minValue,
        maxValue: source.maxValue,
        listValues: source.listValues,
        fileTypes: source.fileTypes,
        sortOrder: firstSortOrder + index,
        assemblyInstructionStepId: source.id,
        companyId,
        createdBy: userId
      }))
    )
    .returning(["id", "assemblyInstructionStepId"])
    .execute();
  const targetIdBySource = new Map(
    insertedSteps.map((step) => [step.assemblyInstructionStepId, step.id])
  );

  // Per-step slides: the instruction's 3D model leads as a model slide,
  // followed by the step's authored slides (image XOR model, with captions,
  // sizes, and annotation pins).
  const slideRows: {
    stepId: string;
    imagePath: string | null;
    modelUploadId: string | null;
    caption: string | null;
    sortOrder: number;
    size: string;
    annotations: string;
    companyId: string;
    createdBy: string;
  }[] = [];
  for (const source of sourceSteps) {
    const targetStepId = targetIdBySource.get(source.id);
    if (!targetStepId) continue;
    const authored = slidesByStep.get(source.id) ?? [];
    const modelUploadId = instruction.modelUploadId;
    if (
      modelUploadId &&
      !authored.some((slide) => slide.modelUploadId === modelUploadId)
    ) {
      slideRows.push({
        stepId: targetStepId,
        imagePath: null,
        modelUploadId,
        caption: null,
        sortOrder: 0,
        size: "medium",
        annotations: JSON.stringify([]),
        companyId,
        createdBy: userId
      });
    }
    for (const slide of authored) {
      slideRows.push({
        stepId: targetStepId,
        imagePath: slide.imagePath,
        modelUploadId: slide.modelUploadId,
        caption: slide.caption,
        sortOrder: slide.sortOrder ?? 1,
        size: slide.size ?? "medium",
        annotations: JSON.stringify(slide.annotations ?? []),
        companyId,
        createdBy: userId
      });
    }
  }
  if (slideRows.length > 0) {
    await trx.insertInto("jobOperationStepSlide").values(slideRows).execute();
  }

  // Per-step tools: one jobOperationTool row per distinct tool item (quantity =
  // max across steps) plus the tool ↔ step scope links.
  const maxQuantityByItemId = new Map<string, number>();
  for (const tools of toolsByStep.values()) {
    for (const tool of tools) {
      maxQuantityByItemId.set(
        tool.itemId,
        Math.max(maxQuantityByItemId.get(tool.itemId) ?? 0, tool.quantity)
      );
    }
  }
  if (maxQuantityByItemId.size > 0) {
    // The operation may already carry rows for these tools (the quote → job
    // direction copies quoteOperationTool BEFORE this runs). Link steps to the
    // existing row instead of inserting a duplicate the MES would list twice.
    const existingTools = await trx
      .selectFrom("jobOperationTool")
      .select(["id", "toolId"])
      .where("operationId", "=", operationId)
      .execute();
    const toolRowIdByItemId = new Map(
      existingTools.map((tool) => [tool.toolId, tool.id])
    );
    const missingTools = [...maxQuantityByItemId.entries()].filter(
      ([itemId]) => !toolRowIdByItemId.has(itemId)
    );
    if (missingTools.length > 0) {
      const insertedTools = await trx
        .insertInto("jobOperationTool")
        .values(
          missingTools.map(([itemId, quantity]) => ({
            operationId,
            toolId: itemId,
            quantity,
            companyId,
            createdBy: userId
          }))
        )
        .returning(["id", "toolId"])
        .execute();
      for (const tool of insertedTools) {
        toolRowIdByItemId.set(tool.toolId, tool.id);
      }
    }
    const toolLinkRows: {
      jobOperationToolId: string;
      jobOperationStepId: string;
    }[] = [];
    for (const source of sourceSteps) {
      const targetStepId = targetIdBySource.get(source.id);
      if (!targetStepId) continue;
      for (const tool of toolsByStep.get(source.id) ?? []) {
        const jobOperationToolId = toolRowIdByItemId.get(tool.itemId);
        if (jobOperationToolId) {
          toolLinkRows.push({
            jobOperationToolId,
            jobOperationStepId: targetStepId
          });
        }
      }
    }
    if (toolLinkRows.length > 0) {
      await trx
        .insertInto("jobOperationToolStep")
        .values(toolLinkRows)
        .execute();
    }
  }
  // Tool ids the instruction accounts for — the method → job copy paths filter
  // methodOperationTool by this set so the same tool isn't inserted a second
  // time (unlinked, so the MES would show it on every step AND on its step).
  return new Set(maxQuantityByItemId.keys());
}

// Post-materials pass: link the assembly-materialized job steps to the job's
// materials, resolving the instruction's per-step itemIds against the
// operation's own make method (same resolution the app-side sync performs).
// Must read jobOperation/jobOperationStep/jobMaterial through the TRANSACTION —
// those rows are uncommitted at this point.
async function linkAssemblyStepMaterialsForJobOperations(
  trx: Transaction<KyselyDatabase>,
  operations: Array<{ operationId: string; assemblyInstructionId: string }>,
  companyId: string
) {
  for (const { operationId } of operations) {
    const operation = await trx
      .selectFrom("jobOperation")
      .select(["jobMakeMethodId"])
      .where("id", "=", operationId)
      .executeTakeFirst();
    if (!operation?.jobMakeMethodId) continue;

    const steps = await trx
      .selectFrom("jobOperationStep")
      .select(["id", "assemblyInstructionStepId"])
      .where("operationId", "=", operationId)
      .where("assemblyInstructionStepId", "is not", null)
      .execute();
    if (steps.length === 0) continue;

    const sourceStepIds = steps.map(
      (step) => step.assemblyInstructionStepId as string
    );
    const stepMaterials = await trx
      .selectFrom("assemblyInstructionStepMaterial")
      .select(["stepId", "itemId", "quantity"])
      .where("stepId", "in", sourceStepIds)
      .where("companyId", "=", companyId)
      .execute();
    if (stepMaterials.length === 0) continue;

    const jobMaterials = await trx
      .selectFrom("jobMaterial")
      .select(["id", "itemId"])
      .where("jobMakeMethodId", "=", operation.jobMakeMethodId)
      .where("companyId", "=", companyId)
      .execute();
    const materialIdByItemId = new Map(
      jobMaterials.map((material) => [material.itemId, material.id])
    );
    const jobStepBySourceStep = new Map(
      steps.map((step) => [step.assemblyInstructionStepId as string, step.id])
    );

    const linkRows = stepMaterials.flatMap((link) => {
      const jobOperationStepId = jobStepBySourceStep.get(link.stepId);
      const jobMaterialId = link.itemId
        ? materialIdByItemId.get(link.itemId)
        : undefined;
      return jobOperationStepId && jobMaterialId
        ? [
            {
              jobMaterialId,
              jobOperationStepId,
              quantity: link.quantity ?? null
            }
          ]
        : [];
    });

    if (linkRows.length > 0) {
      await trx
        .insertInto("jobMaterialStep")
        .values(linkRows)
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
}

async function hydrateConfiguration(
  db: Kysely<KyselyDatabase>,
  configuration: Record<string, unknown> | undefined,
  itemId: string | undefined | null,
  companyId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    if (!configuration || !itemId || Object.keys(configuration).length === 0) {
      return configuration;
    }

    const materialParams = await db
      .selectFrom("configurationParameter")
      .select(["key"])
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId)
      .where("dataType", "=", "material")
      .execute();

    const materialKeys = new Set(materialParams.map((p) => p.key));

    if (materialKeys.size === 0) return configuration;

    const entries = Object.entries(configuration).filter(
      ([key, value]) =>
        materialKeys.has(key) && typeof value === "string" && value
    );

    if (entries.length === 0) return configuration;

    const itemIds = entries.map(([, value]) => value as string);

    // Get items that correspond to the item IDs
    const items = await db
      .selectFrom("item")
      .select(["id", "readableId"])
      .where("id", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute();

    // Create map of itemId to readableId (which is the materialId)
    const itemIdToMaterialId = new Map(items.map((i) => [i.id, i.readableId]));

    const materialIds = items.map((i) => i.readableId);
    if (materialIds.length === 0) return configuration;

    // Get material details using the readableIds (which are the material IDs)
    const materials = await db
      .selectFrom("material")
      .select([
        "id",
        "materialFormId",
        "materialSubstanceId",
        "materialTypeId",
        "dimensionId",
        "finishId",
        "gradeId"
      ])
      .where("id", "in", materialIds)
      .where("companyId", "=", companyId)
      .execute();

    const materialsByMaterialId = new Map(materials.map((m) => [m.id, m]));

    const transformed: Record<string, unknown> = { ...configuration };

    for (const [key, value] of entries) {
      const itemId = value as string;
      const materialId = itemIdToMaterialId.get(itemId);

      if (materialId) {
        const material = materialsByMaterialId.get(materialId);
        if (material) {
          transformed[key] = {
            id: itemId,
            materialFormId: material.materialFormId ?? null,
            materialSubstanceId: material.materialSubstanceId ?? null,
            materialTypeId: material.materialTypeId ?? null,
            dimensionId: material.dimensionId ?? null,
            finishId: material.finishId ?? null,
            gradeId: material.gradeId ?? null
          };
        }
      }
    }

    return transformed;
  } catch (err) {
    logger.error("configuration transform failed", {
      error: String((err as Error)?.stack ?? err)
    });
    return configuration;
  }
}

export default getMethod;
