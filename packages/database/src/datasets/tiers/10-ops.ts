import { resolveDate, resolveTimestamp } from "../dates.ts";
import { insertId, insertRow, need, nextSequence, one, RICH } from "../sql.ts";
import type {
  Ctx,
  InstantSpec,
  MaintenanceDispatchSpec,
  MaintenanceScheduleSpec,
  TrainingQuestionSpec,
  TrainingSpec
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

async function failureModeId(ctx: Ctx, name: string): Promise<string> {
  const row = await one<{ id: string }>(
    ctx.client,
    `SELECT id FROM "maintenanceFailureMode" WHERE "companyId" = $1 AND name = $2 LIMIT 1`,
    [ctx.companyId, name]
  );
  return row.id;
}

async function seedSchedule(
  ctx: Ctx,
  spec: MaintenanceScheduleSpec
): Promise<void> {
  const weekends = spec.weekends ?? true;
  const scheduleId = await insertId(ctx, "maintenanceSchedule", {
    name: spec.name,
    description: spec.description,
    workCenterId: need(ctx.refs.workCenters, spec.workCenter, "work center"),
    locationId: need(ctx.refs.locations, "Plant", "location"),
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
  const plantId = need(ctx.refs.locations, "Plant", "location");
  const workCenterId = need(
    ctx.refs.workCenters,
    spec.workCenter,
    "work center"
  );
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
    locationId: plantId,
    maintenanceScheduleId: scheduleId,
    nonConformanceId: spec.nonConformance
      ? need(ctx.refs.documents, spec.nonConformance, "NCR")
      : undefined,
    suspectedFailureModeId: spec.suspectedFailureMode
      ? await failureModeId(ctx, spec.suspectedFailureMode)
      : undefined,
    actualFailureModeId: spec.actualFailureMode
      ? await failureModeId(ctx, spec.actualFailureMode)
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
    const dispatchItemId = await insertId(ctx, "maintenanceDispatchItem", {
      maintenanceDispatchId: dispatchId,
      itemId: item.id,
      quantity: part.quantity,
      unitOfMeasureCode: item.unitOfMeasureCode
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
      locationId: plantId,
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
