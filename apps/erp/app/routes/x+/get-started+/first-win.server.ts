import { openai } from "@ai-sdk/openai";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { nanoid } from "nanoid";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  upsertMethodMaterial,
  upsertMethodOperation,
  upsertPart
} from "~/modules/items";
import {
  getLocationsList,
  getProcessesList,
  getWorkCentersList,
  upsertProcess,
  upsertWorkCenter
} from "~/modules/resources";

// First Win — server pipeline. Drafts the customer's bread-and-butter part as a
// REAL item (part + BOM + routing + cost) through a graceful ladder:
//   1. upload parses → AI picks one representative assembly from the sample
//   2. no/unusable upload → AI drafts from the intake's product description
//   3. AI unavailable/fails → deterministic placeholder shell, no routing
// Nothing silently commits: every created row is visibly a draft (tags +
// "— draft"/"replace me" labels) that the customer corrects.

const logger = getLogger("erp", "first-win");

const AI_DRAFT_TAG = "ai-draft";

// ---------------------------------------------------------------------------
// Draft shape
// ---------------------------------------------------------------------------

const childComponentSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional()
});

const componentSchema = z.object({
  name: z.string().min(1).max(200),
  partNumber: z.string().max(40).optional(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  isPlaceholder: z.boolean(),
  children: z.array(childComponentSchema).max(8).optional()
});

const firstWinDraftSchema = z.object({
  partName: z.string().min(1).max(200),
  partNumber: z.string().min(1).max(40),
  description: z.string().max(1000).optional(),
  unitPrice: z.number().nonnegative().optional(),
  components: z.array(componentSchema).min(3).max(8),
  operations: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        minutes: z.number().positive()
      })
    )
    .max(3)
    .optional()
});

export type FirstWinDraft = z.infer<typeof firstWinDraftSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cap = (value: string, max: number) =>
  value.length > max ? value.slice(0, max) : value;

// Part-number slug: uppercase alphanumeric + dashes, at most 20 chars.
function toPartNumber(raw: string | null | undefined): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 20)
    .replace(/-+$/, "");
}

// Dedupe part numbers within one draft (DB collisions get a retry separately).
function uniquePartNumber(base: string, used: Set<string>): string {
  const root = base || "DRAFT-PART";
  let candidate = root;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `-${n++}`;
    candidate = `${root.slice(0, 20 - suffix.length)}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

// Placeholder lines must read as drafts wherever they appear — the component
// item's name is what the BOM line displays.
function labelDraftLine(name: string, isPlaceholder: boolean): string {
  const trimmed = name.trim();
  if (!isPlaceholder) return cap(trimmed, 255);
  if (/draft|replace me/i.test(trimmed)) return cap(trimmed, 255);
  return cap(`${trimmed} — draft`, 255);
}

function isUniqueViolation(error: { code?: string; message?: string }) {
  return (
    error?.code === "23505" ||
    (error?.message ?? "").toLowerCase().includes("duplicate")
  );
}

// ---------------------------------------------------------------------------
// The graceful ladder
// ---------------------------------------------------------------------------

async function readUploadSample(
  client: SupabaseClient<Database>,
  uploadPath: string,
  uploadName: string | null | undefined
): Promise<string | null> {
  try {
    const download = await client.storage.from("private").download(uploadPath);
    if (download.error || !download.data) {
      if (download.error) {
        logger.error("Failed to download intake upload", {
          error: download.error
        });
      }
      return null;
    }

    const extension =
      (uploadName ?? uploadPath).split(".").pop()?.toLowerCase() ?? "";

    let text: string | null = null;
    if (["csv", "tsv", "txt"].includes(extension)) {
      text = await download.data.text();
    } else if (["xlsx", "xls"].includes(extension)) {
      // xlsx is already a dependency of apps/erp — no new packages.
      const buffer = await download.data.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return null;
      text = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    } else {
      return null;
    }

    if (!text?.trim()) return null;

    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const rows = (parsed.data ?? []).filter(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => String(cell ?? "").trim() !== "")
    );
    if (rows.length === 0) return null;

    // Sample up to ~80 rows, bounded cells, bounded total size.
    const sample = rows
      .slice(0, 80)
      .map((row) =>
        row.slice(0, 24).map((cell) => String(cell ?? "").slice(0, 200))
      );
    const csv = Papa.unparse(sample);
    return csv.length > 16000 ? csv.slice(0, 16000) : csv;
  } catch (err) {
    logger.error("Failed to parse intake upload", { error: err });
    return null;
  }
}

const DRAFT_RULES = `
Rules:
- Pick the bread-and-butter assembly: the MOST REPRESENTATIVE product they make all the time, NOT the most complex one.
- 3 to 8 components with realistic quantities.
- At most ONE nested level: give a component "children" only when it is clearly a sub-assembly.
- Mark any line you are not confident about with isPlaceholder: true.
- Keep every name under 100 characters.
- partNumber must be a short slug: uppercase letters, numbers, and dashes only, at most 20 characters.
- 1 to 3 routing operations ("operations"), each with a realistic number of minutes per piece.
`;

function normalizeDraft(
  raw: FirstWinDraft,
  allPlaceholder: boolean
): FirstWinDraft {
  return {
    partName: cap(raw.partName.trim(), 100),
    partNumber: raw.partNumber,
    description: raw.description ? cap(raw.description, 1000) : undefined,
    unitPrice: raw.unitPrice,
    components: raw.components.slice(0, 8).map((component) => ({
      name: cap(component.name.trim(), 100),
      partNumber: component.partNumber,
      quantity: component.quantity > 0 ? component.quantity : 1,
      unitCost: component.unitCost,
      isPlaceholder: allPlaceholder ? true : component.isPlaceholder,
      children: component.children?.slice(0, 8).map((child) => ({
        name: cap(child.name.trim(), 100),
        quantity: child.quantity > 0 ? child.quantity : 1,
        unitCost: child.unitCost
      }))
    })),
    operations: (raw.operations ?? []).slice(0, 3).map((operation) => ({
      name: cap(operation.name.trim(), 100),
      minutes: operation.minutes > 0 ? operation.minutes : 10
    }))
  };
}

// Level 3 — the deterministic shell: a part named from the product text with
// three clearly-labeled placeholder components and no routing.
function fallbackDraft(product: string | null): FirstWinDraft {
  const base = product?.trim() || "Your first part";
  return {
    partName: cap(base, 100),
    partNumber: toPartNumber(base) || "FIRST-PART",
    description:
      "Drafted by Carbon during onboarding. Replace the placeholder lines below with the real bill of materials.",
    components: [
      { name: "Main material — replace me", quantity: 1, isPlaceholder: true },
      {
        name: "Purchased component — replace me",
        quantity: 1,
        isPlaceholder: true
      },
      {
        name: "Hardware or fasteners — replace me",
        quantity: 1,
        isPlaceholder: true
      }
    ],
    operations: []
  };
}

export async function buildFirstWinDraft(
  client: SupabaseClient<Database>,
  args: {
    product: string | null;
    uploadPath: string | null;
    uploadName: string | null;
  }
): Promise<{ draft: FirstWinDraft; usedFallback: boolean }> {
  const productLine = args.product?.trim() || "(not provided)";

  // Level 1 — upload exists and parses: the AI picks one representative
  // assembly from the sample.
  if (args.uploadPath) {
    const sample = await readUploadSample(
      client,
      args.uploadPath,
      args.uploadName
    );
    if (sample) {
      try {
        const { object } = await generateObject({
          model: openai("gpt-4o"),
          schema: firstWinDraftSchema,
          prompt: `
          You are drafting a manufacturer's first part inside their new manufacturing ERP.
          The factory describes what it makes as: "${productLine}".

          Below is a sample of a spreadsheet they uploaded (an item list, BOM export, or similar), as CSV:

          ${sample}

          From this data, pick ONE representative assembly and draft it: the part, a one-to-two-level bill of materials, a short routing, and costs/prices where the file provides them (omit costs you cannot see).
          ${DRAFT_RULES}
          `,
          temperature: 0.2
        });
        return { draft: normalizeDraft(object, false), usedFallback: false };
      } catch (error) {
        logger.error("First Win AI draft from upload failed", { error });
      }
    }
  }

  // Level 2 — no usable upload: draft from the product description alone;
  // every line is a placeholder.
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: firstWinDraftSchema,
      prompt: `
      You are drafting a manufacturer's first part inside their new manufacturing ERP.
      The factory describes what it makes as: "${productLine}".

      There is no uploaded data, so draft a plausible example of their bread-and-butter product: the part, a one-to-two-level bill of materials, and a short routing. Set isPlaceholder: true on EVERY component — these are educated guesses the customer will correct. Omit unitCost and unitPrice unless obvious.
      ${DRAFT_RULES}
      `,
      temperature: 0.2
    });
    return { draft: normalizeDraft(object, true), usedFallback: false };
  } catch (error) {
    logger.error("First Win AI draft from product text failed", { error });
  }

  // Level 3 — deterministic shell.
  return { draft: fallbackDraft(args.product), usedFallback: true };
}

// ---------------------------------------------------------------------------
// Creating the draft as real records
// ---------------------------------------------------------------------------

type DraftPartArgs = {
  id: string;
  name: string;
  description?: string;
  replenishmentSystem: "Buy" | "Make";
  defaultMethodType: "Purchase to Order" | "Make to Order";
  unitCost?: number;
  unitOfMeasureCode: string;
  companyId: string;
  userId: string;
};

// Insert a part via the canonical service; on a duplicate part number retry
// once with a "-2" suffix. Tags the part row as an AI draft (the item table has
// no tags column; part does).
async function insertDraftPart(
  client: SupabaseClient<Database>,
  args: DraftPartArgs,
  usedIds: Set<string>
): Promise<
  | { itemId: string; readableId: string; error: null }
  | { itemId: null; readableId: null; error: { message: string } }
> {
  const payload = (id: string) => ({
    id,
    name: args.name,
    description: args.description,
    revision: "0",
    replenishmentSystem: args.replenishmentSystem,
    defaultMethodType: args.defaultMethodType,
    itemTrackingType: "Inventory" as const,
    unitOfMeasureCode: args.unitOfMeasureCode,
    unitCost: args.unitCost,
    lotSize: 0,
    shelfLifeCalculateFromBom: false,
    companyId: args.companyId,
    createdBy: args.userId
  });

  let readableId = args.id;
  let result = await upsertPart(client, payload(readableId));
  if (result.error && isUniqueViolation(result.error)) {
    readableId = uniquePartNumber(`${args.id.slice(0, 18)}-2`, usedIds);
    result = await upsertPart(client, payload(readableId));
  }
  if (result.error) {
    logger.error("First Win part insert failed", { error: result.error });
    return {
      itemId: null,
      readableId: null,
      error: { message: result.error.message }
    };
  }
  const itemId = result.data?.id;
  if (!itemId) {
    return {
      itemId: null,
      readableId: null,
      error: { message: "Part was created but could not be read back" }
    };
  }

  // Draft labeling — non-fatal if it fails.
  const tagged = await client
    .from("part")
    .update({ tags: [AI_DRAFT_TAG] })
    .eq("id", readableId)
    .eq("companyId", args.companyId);
  if (tagged.error) {
    logger.error("Failed to tag draft part", { error: tagged.error });
  }

  return { itemId, readableId, error: null };
}

async function getDraftMakeMethodId(
  client: SupabaseClient<Database>,
  itemId: string
): Promise<string | null> {
  // Same lookup the cost-recalculate route uses: the active (or draft
  // fallback) make method for the item, auto-created by DB trigger.
  const makeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();
  return makeMethod.data?.id ?? null;
}

// Routing needs a process + work center. Reuse the company's existing ones when
// present; otherwise seed ONE clearly-named draft of each (they seed Phase 2
// rather than fight it). Work centers need a location — with no location we
// skip routing entirely. All failures are graceful (null → skip routing).
async function resolveRoutingResources(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
): Promise<{ processId: string; workCenterId: string } | null> {
  const [processes, workCenters] = await Promise.all([
    getProcessesList(client, companyId),
    getWorkCentersList(client, companyId)
  ]);

  const existingProcessId = processes.data?.[0]?.id ?? null;
  const existingWorkCenter = workCenters.data?.[0] ?? null;

  if (existingWorkCenter?.id) {
    // Prefer a process actually linked to this work center.
    const linkedProcessId =
      (existingWorkCenter.processes as string[] | null)?.[0] ??
      existingProcessId;
    if (linkedProcessId) {
      return {
        processId: linkedProcessId,
        workCenterId: existingWorkCenter.id
      };
    }
    const createdProcess = await upsertProcess(client, {
      name: "General — draft",
      processType: "Inside",
      defaultStandardFactor: "Minutes/Piece",
      completeAllOnScan: false,
      workCenters: [existingWorkCenter.id],
      companyId,
      createdBy: userId
    });
    if (createdProcess.error || !createdProcess.data?.id) {
      logger.error("Failed to create draft process", {
        error: createdProcess.error
      });
      return null;
    }
    await client
      .from("process")
      .update({ tags: [AI_DRAFT_TAG] })
      .eq("id", createdProcess.data.id)
      .eq("companyId", companyId);
    return {
      processId: createdProcess.data.id,
      workCenterId: existingWorkCenter.id
    };
  }

  // No work center yet — we need a location to create one.
  const locations = await getLocationsList(client, companyId);
  const locationId = locations.data?.[0]?.id;
  if (!locationId) return null;

  let processId = existingProcessId;
  if (!processId) {
    const createdProcess = await upsertProcess(client, {
      name: "General — draft",
      processType: "Inside",
      defaultStandardFactor: "Minutes/Piece",
      completeAllOnScan: false,
      companyId,
      createdBy: userId
    });
    if (createdProcess.error || !createdProcess.data?.id) {
      logger.error("Failed to create draft process", {
        error: createdProcess.error
      });
      return null;
    }
    processId = createdProcess.data.id;
    await client
      .from("process")
      .update({ tags: [AI_DRAFT_TAG] })
      .eq("id", processId)
      .eq("companyId", companyId);
  }

  const createdWorkCenter = await upsertWorkCenter(client, {
    name: "Main work center — draft",
    description:
      "Drafted during onboarding so your first part can be costed. Rename or replace it in Set Up the Basics.",
    defaultStandardFactor: "Minutes/Piece",
    // A modest default labor rate so the cost roll-up produces a number.
    laborRate: 30,
    machineRate: 0,
    overheadRate: 0,
    locationId,
    processes: [processId],
    companyId,
    createdBy: userId
  });
  if (createdWorkCenter.error || !createdWorkCenter.data?.id) {
    logger.error("Failed to create draft work center", {
      error: createdWorkCenter.error
    });
    return null;
  }
  await client
    .from("workCenter")
    .update({ tags: [AI_DRAFT_TAG] })
    .eq("id", createdWorkCenter.data.id)
    .eq("companyId", companyId);

  return { processId, workCenterId: createdWorkCenter.data.id };
}

export async function createFirstWinDraft(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; draft: FirstWinDraft }
): Promise<
  | {
      data: {
        itemId: string;
        readableId: string;
        partName: string;
        skippedRouting: boolean;
      };
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  const { companyId, userId, draft } = args;

  // Unit of measure: prefer the company's seeded "EA", else the first
  // available. With none we cannot create anything — fail gracefully.
  const unitsOfMeasure = await client
    .from("unitOfMeasure")
    .select("code")
    .eq("companyId", companyId)
    .eq("active", true);
  if (unitsOfMeasure.error) {
    return { data: null, error: { message: unitsOfMeasure.error.message } };
  }
  const unitOfMeasureCode =
    unitsOfMeasure.data?.find((uom) => uom.code === "EA")?.code ??
    unitsOfMeasure.data?.[0]?.code;
  if (!unitOfMeasureCode) {
    return {
      data: null,
      error: {
        message:
          "No units of measure exist for this company yet — add one in settings first"
      }
    };
  }

  const usedIds = new Set<string>();

  // 1. The root part — the bread-and-butter product itself.
  const rootId = uniquePartNumber(
    toPartNumber(draft.partNumber) || toPartNumber(draft.partName),
    usedIds
  );
  const root = await insertDraftPart(
    client,
    {
      id: rootId,
      name: cap(draft.partName, 255),
      description:
        draft.description ??
        "Drafted by Carbon from your intake — a draft to correct, not a commitment.",
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order",
      unitOfMeasureCode,
      companyId,
      userId
    },
    usedIds
  );
  if (root.error) return { data: null, error: root.error };

  const rootMakeMethodId = await getDraftMakeMethodId(client, root.itemId);
  if (!rootMakeMethodId) {
    return {
      data: null,
      error: { message: "No make method was created for the drafted part" }
    };
  }

  // Suggested sale price, when the AI extracted one (row auto-created by
  // trigger). Non-fatal.
  if (draft.unitPrice) {
    const price = await client
      .from("itemUnitSalePrice")
      .update({ unitSalePrice: draft.unitPrice, updatedBy: userId })
      .eq("itemId", root.itemId)
      .eq("companyId", companyId);
    if (price.error) {
      logger.error("Failed to set draft sale price", { error: price.error });
    }
  }

  // 2. Components → real (tagged) items + BOM lines on the root make method.
  let order = 1;
  for (const component of draft.components) {
    const isAssembly = (component.children?.length ?? 0) > 0;
    const componentId = uniquePartNumber(
      toPartNumber(component.partNumber) || toPartNumber(component.name),
      usedIds
    );
    const componentPart = await insertDraftPart(
      client,
      {
        id: componentId,
        name: labelDraftLine(component.name, component.isPlaceholder),
        replenishmentSystem: isAssembly ? "Make" : "Buy",
        defaultMethodType: isAssembly ? "Make to Order" : "Purchase to Order",
        unitCost: isAssembly ? undefined : component.unitCost,
        unitOfMeasureCode,
        companyId,
        userId
      },
      usedIds
    );
    if (componentPart.error) return { data: null, error: componentPart.error };

    // Sub-assembly: its own BOM lines (one nested level max).
    if (isAssembly && component.children) {
      const subMakeMethodId = await getDraftMakeMethodId(
        client,
        componentPart.itemId
      );
      if (subMakeMethodId) {
        let childOrder = 1;
        for (const child of component.children) {
          const childId = uniquePartNumber(toPartNumber(child.name), usedIds);
          const childPart = await insertDraftPart(
            client,
            {
              id: childId,
              name: labelDraftLine(child.name, component.isPlaceholder),
              replenishmentSystem: "Buy",
              defaultMethodType: "Purchase to Order",
              unitCost: child.unitCost,
              unitOfMeasureCode,
              companyId,
              userId
            },
            usedIds
          );
          if (childPart.error) return { data: null, error: childPart.error };

          const childLine = await upsertMethodMaterial(client, {
            id: nanoid(),
            makeMethodId: subMakeMethodId,
            order: childOrder++,
            itemType: "Part",
            kit: false,
            // Advisory only — upsertMethodMaterial re-derives both from the
            // component item.
            methodType: "Purchase to Order",
            sourcingType: "Specified",
            itemId: childPart.itemId,
            quantity: child.quantity,
            unitOfMeasureCode,
            storageUnitIds: {},
            companyId,
            createdBy: userId
          });
          if (childLine.error) {
            return { data: null, error: { message: childLine.error.message } };
          }
        }
      }
    }

    const line = await upsertMethodMaterial(client, {
      id: nanoid(),
      makeMethodId: rootMakeMethodId,
      order: order++,
      itemType: "Part",
      kit: false,
      methodType: isAssembly ? "Make to Order" : "Purchase to Order",
      sourcingType: "Specified",
      itemId: componentPart.itemId,
      quantity: component.quantity,
      unitOfMeasureCode,
      storageUnitIds: {},
      companyId,
      createdBy: userId
    });
    if (line.error) {
      return { data: null, error: { message: line.error.message } };
    }
  }

  // 3. Routing — only when a work center can exist. Failures here are
  // non-fatal: the part + BOM stand on their own.
  const wantsRouting = (draft.operations?.length ?? 0) > 0;
  let createdOperations = 0;
  if (wantsRouting) {
    const routing = await resolveRoutingResources(client, companyId, userId);
    if (routing) {
      let operationOrder = 1;
      for (const operation of draft.operations ?? []) {
        const inserted = await upsertMethodOperation(client, {
          makeMethodId: rootMakeMethodId,
          order: operationOrder++,
          operationOrder: "After Previous",
          operationType: "Inside",
          processId: routing.processId,
          workCenterId: routing.workCenterId,
          description: cap(operation.name, 255),
          setupTime: 0,
          setupUnit: "Total Minutes",
          laborTime: operation.minutes,
          laborUnit: "Minutes/Piece",
          machineTime: 0,
          machineUnit: "Minutes/Piece",
          companyId,
          createdBy: userId
        });
        if (inserted.error) {
          logger.error("First Win operation insert failed", {
            error: inserted.error
          });
          break;
        }
        createdOperations++;
      }
    }
  }

  return {
    data: {
      itemId: root.itemId,
      readableId: root.readableId,
      partName: cap(draft.partName, 255),
      skippedRouting: wantsRouting && createdOperations === 0
    },
    error: null
  };
}
