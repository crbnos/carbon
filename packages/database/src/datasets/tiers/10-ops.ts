import { resolveDate, resolveTimestamp } from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import {
  insertId,
  insertRow,
  maybeOne,
  need,
  nextSequence,
  one,
  RICH
} from "../sql.ts";
import type {
  AttributeDataTypeLabel,
  Ctx,
  CustomFieldSpec,
  InstantSpec,
  MaintenanceDispatchSpec,
  MaintenanceScheduleSpec,
  PrintJobSpec,
  TrainingQuestionSpec,
  TrainingSpec,
  UserAttributeCategorySpec
} from "../types.ts";

// Every ops row is written in the shape the app's own create/transition paths
// leave it.

export async function runTier10(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.ops;

  ctx.log(`maintenance schedules — ${data.maintenanceSchedules.length}`);
  for (const spec of data.maintenanceSchedules) {
    await seedSchedule(ctx, spec);
  }

  ctx.log(`maintenance dispatches — ${data.maintenanceDispatches.length}`);
  for (const spec of data.maintenanceDispatches) {
    await seedDispatch(ctx, spec);
  }

  ctx.log(`work-center replacement parts — ${data.replacementParts.length}`);
  for (const spec of data.replacementParts) {
    const item = need(ctx.refs.items, spec.item, "item");
    await insertRow(ctx, "workCenterReplacementPart", {
      workCenterId: need(ctx.refs.workCenters, spec.workCenter, "work center"),
      itemId: item.id,
      quantity: spec.quantity,
      unitOfMeasureCode: item.unitOfMeasureCode
    });
  }

  ctx.log(`trainings — ${data.trainings.length}`);
  for (const spec of data.trainings) {
    await seedTraining(ctx, spec);
  }

  ctx.log(`timecards — ${data.timecards.length}`);
  for (const card of data.timecards) {
    await insertRow(ctx, "timeCardEntry", {
      employeeId: ctx.userId,
      clockIn: resolveTimestamp(ctx.anchor, card.dayOffset, card.clockIn),
      clockOut: resolveTimestamp(ctx.anchor, card.dayOffset, card.clockOut),
      note: card.note
    });
  }

  // companySettings has no companyId, so the wipe keeps it; without the flag
  // both apps hide the time clock and redirect away from the timecard pages.
  ctx.log("time clock — enabled, clocked in today");
  await insertRow(
    ctx,
    "companySettings",
    { id: ctx.companyId, timeCardEnabled: true },
    { onConflict: '("id") DO UPDATE SET "timeCardEnabled" = true' }
  );
  // The MES reads the open entry with maybeSingle, so there is exactly one.
  await insertRow(ctx, "timeCardEntry", {
    employeeId: ctx.userId,
    clockIn: resolveTimestamp(ctx.anchor, 0, data.openTimecard.clockIn),
    clockOut: null,
    note: data.openTimecard.note
  });

  ctx.log(
    `people assignments — ${data.peopleAssignments.length}, absences — ${data.peopleAbsences.length}`
  );
  const plantId = need(ctx.refs.locations, "Plant", "location");
  for (const spec of data.peopleAssignments) {
    await insertRow(ctx, "peopleAssignment", {
      locationId: plantId,
      workCenterId: need(ctx.refs.workCenters, spec.workCenter, "work center"),
      employeeId: ctx.userId,
      date: resolveDate(ctx.anchor, spec.dayOffset),
      shiftId: need(ctx.refs.shifts, spec.shift, "shift"),
      overtimeHours: spec.overtimeHours ?? 0,
      note: spec.note
    });
  }
  for (const spec of data.peopleAbsences) {
    await insertRow(ctx, "peopleAbsence", {
      employeeId: ctx.userId,
      date: resolveDate(ctx.anchor, spec.dayOffset),
      shiftId: spec.shift ? need(ctx.refs.shifts, spec.shift, "shift") : null,
      note: spec.note
    });
  }

  // suggestion has no createdBy; userId is the submitting user (null = anonymous).
  for (const spec of data.suggestions) {
    await insertRow(ctx, "suggestion", {
      suggestion: spec.suggestion,
      emoji: spec.emoji,
      path: spec.path,
      tags: spec.tags ?? [],
      userId: ctx.userId
    });
  }

  // insertNote writes the rich-text form's HTML into `note` and leaves
  // noteRichText at its '{}' default.
  for (const spec of data.notes) {
    await insertRow(ctx, "note", {
      documentId: ctx.userId,
      note: `<p>${escapeHtml(spec.text)}</p>`
    });
  }

  ctx.log(
    `user attributes — ${data.userAttributeCategories.length} categories, custom fields — ${data.customFields.length}`
  );
  for (const spec of data.userAttributeCategories) {
    await seedAttributeCategory(ctx, spec);
  }
  await seedCustomFields(ctx, data.customFields);

  ctx.log(`item serial sequences — ${data.serialSequences.length}`);
  for (const spec of data.serialSequences) {
    await insertRow(ctx, "itemSerialSequence", {
      itemId: need(ctx.refs.items, spec.item, "item").id,
      prefix: spec.prefix,
      suffix: spec.suffix ?? null,
      size: spec.size,
      next: spec.next,
      step: 1
    });
  }

  ctx.log(`print jobs — ${data.printJobs.length}`);
  for (const spec of data.printJobs) {
    await seedPrintJob(ctx, spec);
  }
}

// A global lookup (no companyId) — the label is its natural key.
async function attributeDataTypeId(
  ctx: Ctx,
  label: AttributeDataTypeLabel
): Promise<number> {
  const key = `attributeDataType:${label}`;
  const cached = ctx.refs.misc[key];
  if (cached) return Number(cached);
  const row = await maybeOne<{ id: number }>(
    ctx.client,
    `SELECT id FROM "attributeDataType" WHERE label = $1`,
    [label]
  );
  if (!row) throw new Error(`Seed: no attributeDataType labelled "${label}"`);
  ctx.refs.misc[key] = String(row.id);
  return row.id;
}

// The wipe keeps userAttributeCategory (and userAttribute / userAttributeValue
// have no companyId), so a re-apply adopts the category and attributes by name
// and upserts the value instead of stacking duplicates.
async function seedAttributeCategory(
  ctx: Ctx,
  spec: UserAttributeCategorySpec
): Promise<void> {
  const existing = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM "userAttributeCategory"
     WHERE "companyId" = $1 AND name = $2 ORDER BY "createdAt" LIMIT 1`,
    [ctx.companyId, spec.name]
  );
  let categoryId: string;
  if (existing) {
    categoryId = existing.id;
    await ctx.client.query(
      `UPDATE "userAttributeCategory"
       SET emoji = $3, public = $4, active = true, "updatedBy" = $5
       WHERE id = $1 AND "companyId" = $2`,
      [categoryId, ctx.companyId, spec.emoji, spec.public, ctx.userId]
    );
  } else {
    categoryId = await insertId(ctx, "userAttributeCategory", {
      name: spec.name,
      emoji: spec.emoji,
      public: spec.public
    });
  }

  for (const [index, attribute] of spec.attributes.entries()) {
    const columns = {
      sortOrder: index + 1,
      attributeDataTypeId: await attributeDataTypeId(ctx, attribute.dataType),
      listOptions: attribute.dataType === "List" ? attribute.listOptions : null,
      canSelfManage: attribute.canSelfManage ?? false
    };
    const found = await maybeOne<{ id: string }>(
      ctx.client,
      `SELECT ua.id FROM "userAttribute" ua
       JOIN "userAttributeCategory" c ON c.id = ua."userAttributeCategoryId"
       WHERE c."companyId" = $1 AND ua."userAttributeCategoryId" = $2 AND ua.name = $3
       ORDER BY ua."createdAt" LIMIT 1`,
      [ctx.companyId, categoryId, attribute.name]
    );
    let attributeId: string;
    if (found) {
      attributeId = found.id;
      await ctx.client.query(
        `UPDATE "userAttribute"
         SET "sortOrder" = $2, "attributeDataTypeId" = $3, "listOptions" = $4,
             "canSelfManage" = $5, active = true, "updatedBy" = $6
         WHERE id = $1`,
        [
          attributeId,
          columns.sortOrder,
          columns.attributeDataTypeId,
          columns.listOptions,
          columns.canSelfManage,
          ctx.userId
        ]
      );
    } else {
      attributeId = await insertId(ctx, "userAttribute", {
        name: attribute.name,
        userAttributeCategoryId: categoryId,
        ...columns
      });
    }

    // Every value column is written, so a re-apply that changes an
    // attribute's type still satisfies the single-value CHECK.
    const value = {
      valueBoolean: attribute.dataType === "Yes/No" ? attribute.value : null,
      valueDate:
        attribute.dataType === "Date"
          ? resolveDate(ctx.anchor, attribute.valueOffset)
          : null,
      valueNumeric: attribute.dataType === "Numeric" ? attribute.value : null,
      valueText:
        attribute.dataType === "List" || attribute.dataType === "Text"
          ? attribute.value
          : null,
      valueUser: attribute.dataType === "User" ? ctx.userId : null,
      valueFile: null
    };
    await insertRow(
      ctx,
      "userAttributeValue",
      { userAttributeId: attributeId, userId: ctx.userId, ...value },
      {
        onConflict: `("userAttributeId", "userId") DO UPDATE SET
          "valueBoolean" = EXCLUDED."valueBoolean", "valueDate" = EXCLUDED."valueDate",
          "valueNumeric" = EXCLUDED."valueNumeric", "valueText" = EXCLUDED."valueText",
          "valueUser" = EXCLUDED."valueUser", "valueFile" = EXCLUDED."valueFile",
          "updatedBy" = EXCLUDED."createdBy"`
      }
    );
  }
}

// customField survives the wipe; UNIQUE (table, name, companyId) is the adopt key.
async function seedCustomFields(
  ctx: Ctx,
  specs: CustomFieldSpec[]
): Promise<void> {
  const perTable = new Map<string, number>();
  for (const spec of specs) {
    const sortOrder = (perTable.get(spec.table) ?? 0) + 1;
    perTable.set(spec.table, sortOrder);
    await insertRow(
      ctx,
      "customField",
      {
        table: spec.table,
        name: spec.name,
        dataTypeId: await attributeDataTypeId(ctx, spec.dataType),
        listOptions: spec.listOptions ?? null,
        sortOrder
      },
      {
        onConflict: `("table", name, "companyId") DO UPDATE SET
          "dataTypeId" = EXCLUDED."dataTypeId", "listOptions" = EXCLUDED."listOptions",
          "sortOrder" = EXCLUDED."sortOrder", active = true, "updatedBy" = EXCLUDED."createdBy"`
      }
    );
  }
}

async function seedPrintJob(ctx: Ctx, spec: PrintJobSpec): Promise<void> {
  const route = ctx.dataset.foundation.printerRoute;
  if (!route) {
    throw new Error("Seed: print jobs need foundation.printerRoute");
  }
  if (route.format !== "zpl") {
    throw new Error(
      `Seed: print jobs render ZPL; the route is "${route.format}"`
    );
  }

  let sourceDocumentId: string;
  let readableId: string;
  const { source } = spec;
  if (source.kind === "Receipt") {
    sourceDocumentId = need(ctx.refs.documents, source.receipt, "receipt");
    readableId = (
      await one<{ readableId: string }>(
        ctx.client,
        `SELECT "receiptId" AS "readableId" FROM receipt WHERE id = $1 AND "companyId" = $2`,
        [sourceDocumentId, ctx.companyId]
      )
    ).readableId;
  } else if (source.kind === "Job") {
    sourceDocumentId = need(ctx.refs.documents, `job:${source.job}`, "job");
    readableId = (
      await one<{ readableId: string }>(
        ctx.client,
        `SELECT "jobId" AS "readableId" FROM job WHERE id = $1 AND "companyId" = $2`,
        [sourceDocumentId, ctx.companyId]
      )
    ).readableId;
  } else {
    sourceDocumentId = need(ctx.refs.shelves, source.shelf, "shelf");
    readableId = source.shelf;
  }

  const label = spec.item ? [readableId, spec.item] : [readableId];
  // What the built-in renderer hands the printer: text lines plus a Code 128 of the id.
  const content = [
    "^XA^CI28",
    ...label.map(
      (text, index) =>
        `^FO40,${40 + index * 50}^A0N,${index === 0 ? 40 : 30},${index === 0 ? 40 : 30}^FD${text}^FS`
    ),
    `^FO40,${50 + label.length * 50}^BCN,80,Y,N,N^FD${readableId}^FS`,
    "^XZ"
  ].join("\n");

  const createdAt = at(ctx, spec.at);
  await insertRow(ctx, "printJob", {
    status: spec.status,
    contentType: route.format,
    content,
    printerUrl: route.printerUrl,
    sourceDocument: source.kind,
    sourceDocumentId,
    sourceDocumentReadableId: readableId,
    description: label.join(" — "),
    origin: spec.origin,
    error: spec.error ?? null,
    attempts: spec.attempts,
    createdAt,
    updatedAt: spec.status === "queued" ? null : createdAt,
    completedAt: spec.status === "completed" ? createdAt : null
  });
}

function at(ctx: Ctx, instant: InstantSpec): string {
  return resolveTimestamp(ctx.anchor, instant.offset, instant.time);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Schedules and dispatches take their work center's location (the plant, or
// HQ for its one work center), as the create forms default it.
async function workCenterLocation(
  ctx: Ctx,
  workCenterId: string
): Promise<string> {
  const row = await one<{ locationId: string }>(
    ctx.client,
    `SELECT "locationId" FROM "workCenter" WHERE id = $1 AND "companyId" = $2`,
    [workCenterId, ctx.companyId]
  );
  return row.locationId;
}

async function seedSchedule(
  ctx: Ctx,
  spec: MaintenanceScheduleSpec
): Promise<void> {
  const weekends = spec.weekends ?? true;
  const workCenterId = need(
    ctx.refs.workCenters,
    spec.workCenter,
    "work center"
  );
  const scheduleId = await insertId(ctx, "maintenanceSchedule", {
    name: spec.name,
    description: spec.description,
    workCenterId,
    locationId: await workCenterLocation(ctx, workCenterId),
    frequency: spec.frequency,
    priority: spec.priority,
    estimatedDuration: spec.estimatedDuration,
    takesWorkCenterOffline: spec.takesWorkCenterOffline ?? false,
    nextDueAt: resolveTimestamp(ctx.anchor, spec.nextDueOffset, "00:00:00"),
    saturday: weekends,
    sunday: weekends,
    active: true
  });
  ctx.refs.misc[`maintenanceSchedule:${spec.key}`] = scheduleId;

  for (const part of spec.spareParts ?? []) {
    const item = need(ctx.refs.items, part.item, "item");
    await insertRow(ctx, "maintenanceScheduleItem", {
      maintenanceScheduleId: scheduleId,
      itemId: item.id,
      quantity: part.quantity,
      unitOfMeasureCode: item.unitOfMeasureCode
    });
  }
}

const ASSIGNED_STATUSES = new Set(["Assigned", "In Progress", "Completed"]);

async function seedDispatch(
  ctx: Ctx,
  spec: MaintenanceDispatchSpec
): Promise<void> {
  const workCenterId = need(
    ctx.refs.workCenters,
    spec.workCenter,
    "work center"
  );
  const locationId = await workCenterLocation(ctx, workCenterId);
  const scheduleId = spec.schedule
    ? need(ctx.refs.misc, `maintenanceSchedule:${spec.schedule}`)
    : undefined;
  const completedAt =
    spec.status === "Completed" && spec.actualEnd
      ? at(ctx, spec.actualEnd)
      : undefined;

  // Inserted in its final state: sync_on_maintenance_dispatch_complete only
  // fires on UPDATE, and duration is GENERATED from the actual start/end.
  const dispatchId = await insertId(ctx, "maintenanceDispatch", {
    maintenanceDispatchId: await nextSequence(ctx, "maintenanceDispatch"),
    status: spec.status,
    priority: spec.priority,
    severity: spec.severity,
    source: spec.source,
    oeeImpact: spec.oeeImpact,
    workCenterId,
    locationId,
    maintenanceScheduleId: scheduleId,
    nonConformanceId: spec.nonConformance
      ? need(ctx.refs.documents, spec.nonConformance, "NCR")
      : undefined,
    suspectedFailureModeId: spec.suspectedFailureMode
      ? await bootstrapIdByName(
          ctx,
          "maintenanceFailureMode",
          spec.suspectedFailureMode
        )
      : undefined,
    actualFailureModeId: spec.actualFailureMode
      ? await bootstrapIdByName(
          ctx,
          "maintenanceFailureMode",
          spec.actualFailureMode
        )
      : undefined,
    plannedStartTime: at(ctx, spec.plannedStart),
    plannedEndTime: at(ctx, spec.plannedEnd),
    actualStartTime: spec.actualStart ? at(ctx, spec.actualStart) : undefined,
    actualEndTime: completedAt,
    completedAt,
    assignee: ASSIGNED_STATUSES.has(spec.status) ? ctx.userId : undefined,
    takesWorkCenterOffline: spec.takesWorkCenterOffline ?? false,
    content: RICH(spec.content),
    createdAt: at(ctx, spec.created),
    updatedBy: ctx.userId
  });
  ctx.refs.misc[`maintenanceDispatch:${spec.key}`] = dispatchId;

  // The generate-maintenance job links a scheduled dispatch to its work center.
  if (spec.source === "Scheduled") {
    await insertRow(ctx, "maintenanceDispatchWorkCenter", {
      maintenanceDispatchId: dispatchId,
      workCenterId
    });
  }

  // The MES Start action opens a labor event; Complete closes it at completedAt.
  if (spec.actualStart) {
    await insertRow(ctx, "maintenanceDispatchEvent", {
      maintenanceDispatchId: dispatchId,
      employeeId: ctx.userId,
      workCenterId,
      startTime: at(ctx, spec.actualStart),
      endTime: completedAt
    });
  }

  for (const comment of spec.comments ?? []) {
    await insertRow(ctx, "maintenanceDispatchComment", {
      maintenanceDispatchId: dispatchId,
      comment
    });
  }

  // Mirrors the `issue` edge function's untracked path: a dispatch item
  // (totalCost is GENERATED) plus a negative Consumption ledger row.
  for (const part of spec.spareParts ?? []) {
    const item = need(ctx.refs.items, part.item, "item");
    if (item.unitCost <= 0) {
      throw new Error(
        `Seed: dispatch "${spec.key}" spare part "${part.item}" has no standard cost`
      );
    }
    const dispatchItemId = await insertId(ctx, "maintenanceDispatchItem", {
      maintenanceDispatchId: dispatchId,
      itemId: item.id,
      quantity: part.quantity,
      unitOfMeasureCode: item.unitOfMeasureCode,
      unitCost: item.unitCost
    });
    await insertRow(ctx, "itemLedger", {
      postingDate: resolveDate(
        ctx.anchor,
        (spec.actualEnd ?? spec.plannedStart).offset
      ),
      entryType: "Consumption",
      documentType: "Maintenance Consumption",
      documentId: dispatchId,
      documentLineId: dispatchItemId,
      itemId: item.id,
      quantity: -part.quantity,
      locationId,
      storageUnitId: need(ctx.refs.shelves, part.shelf, "shelf")
    });
  }
}

/** The columns the question editor leaves per type (resources.models.ts + $id.questions.new). */
function questionColumns(q: TrainingQuestionSpec): Record<string, unknown> {
  const base = {
    options: null as string[] | null,
    correctAnswers: null as string[] | null,
    correctBoolean: false,
    matchingPairs: JSON.stringify([]),
    correctNumber: null as number | null,
    tolerance: null as number | null
  };
  switch (q.type) {
    case "MultipleChoice":
      return { ...base, options: q.options, correctAnswers: [q.correct] };
    case "MultipleAnswers":
      return { ...base, options: q.options, correctAnswers: q.correct };
    case "TrueFalse":
      return { ...base, correctBoolean: q.answer };
    case "MatchingPairs":
      return { ...base, matchingPairs: JSON.stringify(q.pairs) };
    case "Numerical":
      return {
        ...base,
        correctNumber: q.answer,
        tolerance: q.tolerance ?? null
      };
  }
}

async function seedTraining(ctx: Ctx, spec: TrainingSpec): Promise<void> {
  const trainingId = await insertId(ctx, "training", {
    name: spec.name,
    description: spec.description,
    status: spec.status,
    frequency: spec.frequency,
    type: spec.type,
    estimatedDuration: spec.estimatedDuration,
    content: JSON.stringify({
      type: "doc",
      content: spec.content.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }]
      }))
    })
  });

  for (const [index, q] of spec.questions.entries()) {
    await insertRow(ctx, "trainingQuestion", {
      trainingId,
      question: q.question,
      type: q.type,
      sortOrder: index + 1,
      ...questionColumns(q)
    });
  }

  if (!spec.assignment) return;
  // A user id is its own identity group, which users_for_groups expands.
  const assignmentId = await insertId(ctx, "trainingAssignment", {
    trainingId,
    groupIds: [ctx.userId]
  });
  const { completedOffset } = spec.assignment;
  if (completedOffset === undefined) return;
  if (spec.frequency !== "Once") {
    throw new Error(
      `Seed: training "${spec.name}": a completion needs a "Once" training (recurring ones key on the current period)`
    );
  }
  // "Once" completions carry a NULL period — the status RPC's join key for them.
  await insertRow(ctx, "trainingCompletion", {
    trainingAssignmentId: assignmentId,
    employeeId: ctx.userId,
    completedAt: resolveTimestamp(ctx.anchor, completedOffset, "15:30:00"),
    completedBy: ctx.userId
  });
}
