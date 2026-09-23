import type { Database, Json } from "@carbon/database";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  changeNoticeImpactTaskCreateRequestValidator,
  changeNoticeImpactTaskRelationshipRequestValidator,
  isJsonObjectTaskNotes
} from "./items.models";
import {
  createAuthorizedChangeNoticeImpactTask,
  designateAuthorizedChangeNoticeImpactTask,
  linkAuthorizedChangeNoticeImpactTask,
  requireChangeNoticeActionTaskEditable,
  requireChangeNoticeEditable,
  unlinkAuthorizedChangeNoticeImpactTask
} from "./items.server";
import {
  deleteChangeNoticeAction,
  deleteChangeNoticeRequiredAction,
  updateChangeNoticeActionAssignee,
  updateChangeNoticeActionDueDate,
  updateChangeNoticeActionNotes,
  updateChangeNoticeActionStatus,
  upsertChangeNoticeRequiredAction
} from "./items.service";

// Server-only MCP companion. The executor supplies the authenticated client,
// tenant, and actor; active-client permissions are authoritative. Impact
// wrappers acquire Kysely only after those checks, so these adapters never take
// a `db` parameter.

async function requireMcpCompanyPermission(
  client: SupabaseClient<Database>,
  companyId: string,
  permission: string
): Promise<void> {
  const result = await client.rpc("get_companies_with_employee_permission", {
    permission
  });

  if (
    result.error ||
    !Array.isArray(result.data) ||
    result.data.some((company) => typeof company !== "string")
  ) {
    throw result.error ?? new Error("Permission check failed.");
  }

  if (!result.data.includes(companyId)) {
    throw new Error(`You do not have ${permission} permission.`);
  }
}

const updateChangeNoticeTaskStatusArgsValidator = z.object({
  changeNoticeId: z.string().min(1),
  actionTaskId: z.string().min(1),
  status: z.enum(["Pending", "In Progress", "Completed", "Skipped"])
});

const updateChangeNoticeTaskNotesArgsValidator = z.object({
  changeNoticeId: z.string().min(1),
  actionTaskId: z.string().min(1),
  notes: z.custom<Json>(isJsonObjectTaskNotes)
});

const updateChangeNoticeTaskAssigneeArgsValidator = z.object({
  changeNoticeId: z.string().min(1),
  actionTaskId: z.string().min(1),
  assignee: z.string().nullable()
});

const updateChangeNoticeTaskDueDateArgsValidator = z.object({
  changeNoticeId: z.string().min(1),
  actionTaskId: z.string().min(1),
  dueDate: z.string().nullable()
});

const deleteChangeNoticeTaskArgsValidator = z.object({
  changeNoticeId: z.string().min(1),
  actionTaskId: z.string().min(1)
});

const upsertChangeNoticeActionTemplateArgsValidator = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  active: z.boolean()
});

const deleteChangeNoticeActionTemplateArgsValidator = z.object({
  id: z.string().min(1)
});

const impactTaskRelationshipArgsValidator = z.object({
  changeNoticeId: z.string().min(1),
  decisionId: z.string().min(1),
  targetType: z.enum(["purchaseOrderLine", "job", "jobMaterial"]),
  targetId: z.string().min(1),
  actionTaskId: z.string().min(1)
});

function validationMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

export async function updateChangeNoticeTaskStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    actionTaskId: string;
    status: "Pending" | "In Progress" | "Completed" | "Skipped";
  }
) {
  const parsed = updateChangeNoticeTaskStatusArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice task status.")
    );
  }

  await requireMcpCompanyPermission(client, companyId, "parts_update");

  const editable = await requireChangeNoticeActionTaskEditable(client, {
    companyId,
    changeNoticeId: parsed.data.changeNoticeId,
    actionTaskId: parsed.data.actionTaskId
  });
  if (editable) throw new Error(editable.error.message);

  return updateChangeNoticeActionStatus(client, {
    id: parsed.data.actionTaskId,
    changeNoticeId: parsed.data.changeNoticeId,
    companyId,
    status: parsed.data.status,
    userId
  });
}

export async function updateChangeNoticeTaskNotes(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    actionTaskId: string;
    notes: Json;
  }
) {
  const parsed = updateChangeNoticeTaskNotesArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice task notes.")
    );
  }

  await requireMcpCompanyPermission(client, companyId, "parts_update");

  const editable = await requireChangeNoticeActionTaskEditable(client, {
    companyId,
    changeNoticeId: parsed.data.changeNoticeId,
    actionTaskId: parsed.data.actionTaskId
  });
  if (editable) throw new Error(editable.error.message);

  return updateChangeNoticeActionNotes(client, {
    id: parsed.data.actionTaskId,
    changeNoticeId: parsed.data.changeNoticeId,
    companyId,
    notes: parsed.data.notes,
    userId
  });
}

export async function updateChangeNoticeTaskAssignee(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    actionTaskId: string;
    assignee: string | null;
  }
) {
  const parsed = updateChangeNoticeTaskAssigneeArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice task assignee.")
    );
  }

  await requireMcpCompanyPermission(client, companyId, "parts_update");

  const editable = await requireChangeNoticeActionTaskEditable(client, {
    companyId,
    changeNoticeId: parsed.data.changeNoticeId,
    actionTaskId: parsed.data.actionTaskId
  });
  if (editable) throw new Error(editable.error.message);

  return updateChangeNoticeActionAssignee(client, {
    id: parsed.data.actionTaskId,
    changeNoticeId: parsed.data.changeNoticeId,
    companyId,
    assignee: parsed.data.assignee || null,
    userId
  });
}

export async function updateChangeNoticeTaskDueDate(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    actionTaskId: string;
    dueDate: string | null;
  }
) {
  const parsed = updateChangeNoticeTaskDueDateArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice task due date.")
    );
  }

  await requireMcpCompanyPermission(client, companyId, "parts_update");

  const editable = await requireChangeNoticeActionTaskEditable(client, {
    companyId,
    changeNoticeId: parsed.data.changeNoticeId,
    actionTaskId: parsed.data.actionTaskId
  });
  if (editable) throw new Error(editable.error.message);

  const rawDueDate = parsed.data.dueDate;
  const dueDate = rawDueDate?.trim()
    ? parseDate(rawDueDate.trim()).toString()
    : null;

  return updateChangeNoticeActionDueDate(client, {
    id: parsed.data.actionTaskId,
    changeNoticeId: parsed.data.changeNoticeId,
    companyId,
    dueDate,
    userId
  });
}

export async function deleteChangeNoticeTask(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    changeNoticeId: string;
    actionTaskId: string;
  }
) {
  const parsed = deleteChangeNoticeTaskArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice task deletion.")
    );
  }

  await requireMcpCompanyPermission(client, companyId, "parts_delete");

  const workflowEditable = await requireChangeNoticeEditable(client, {
    companyId,
    changeNoticeId: parsed.data.changeNoticeId,
    scope: "workflow"
  });
  if (workflowEditable) throw new Error(workflowEditable.error.message);

  const task = await client
    .from("changeOrderActionTask")
    .select("id, companyId, changeOrderId")
    .eq("id", parsed.data.actionTaskId)
    .eq("changeOrderId", parsed.data.changeNoticeId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (
    task.error ||
    !task.data ||
    task.data.id !== parsed.data.actionTaskId ||
    task.data.companyId !== companyId ||
    task.data.changeOrderId !== parsed.data.changeNoticeId
  ) {
    throw new Error("Record does not belong to this change notice.");
  }

  return deleteChangeNoticeAction(client, {
    id: parsed.data.actionTaskId,
    changeNoticeId: parsed.data.changeNoticeId,
    companyId
  });
}

export async function upsertChangeNoticeActionTemplate(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    id?: string;
    name: string;
    active: boolean;
  }
) {
  const parsed = upsertChangeNoticeActionTemplateArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice action template.")
    );
  }

  await requireMcpCompanyPermission(
    client,
    companyId,
    parsed.data.id ? "parts_update" : "parts_create"
  );

  return upsertChangeNoticeRequiredAction(client, {
    id: parsed.data.id,
    name: parsed.data.name,
    active: parsed.data.active,
    companyId,
    userId
  });
}

export async function deleteChangeNoticeActionTemplate(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    id: string;
  }
) {
  const parsed = deleteChangeNoticeActionTemplateArgsValidator.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      validationMessage(parsed.error, "Invalid Change Notice action template.")
    );
  }

  await requireMcpCompanyPermission(client, companyId, "parts_delete");

  return deleteChangeNoticeRequiredAction(client, parsed.data.id, companyId);
}

export async function createImpactFollowUpTask(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    targetType: "purchaseOrderLine" | "job" | "jobMaterial";
    targetId: string;
    decision?: {
      decisionId: string;
      targetType: "purchaseOrderLine" | "job" | "jobMaterial";
      targetId: string;
    };
    bootstrapDecision?: {
      decisionStatus: "Action required";
      rationale: string;
    };
    task: {
      name?: string;
      notes?: Json | null;
      assignee?: string | null;
      dueDate?: string | null;
    };
  }
) {
  if (
    !args?.task ||
    typeof args.task !== "object" ||
    Array.isArray(args.task)
  ) {
    return {
      data: null,
      error: { message: "Impact task details are required." }
    };
  }

  // Normalize the due date the same way the update adapter does, so the create
  // path cannot accept a non-canonical date the browser route rejects.
  const rawDueDate = args.task.dueDate;
  let normalizedDueDate = rawDueDate;
  if (typeof rawDueDate === "string") {
    const trimmed = rawDueDate.trim();
    if (!trimmed) {
      normalizedDueDate = null;
    } else {
      try {
        normalizedDueDate = parseDate(trimmed).toString();
      } catch {
        return {
          data: null,
          error: { message: "Invalid Change Notice Impact task due date." }
        };
      }
    }
  }

  const request = {
    changeNoticeId: args?.changeNoticeId,
    targetType: args?.targetType,
    targetId: args?.targetId,
    decision: args?.decision
      ? {
          decisionId: args.decision.decisionId,
          targetType: args.decision.targetType,
          targetId: args.decision.targetId
        }
      : undefined,
    bootstrapDecision: args?.bootstrapDecision
      ? {
          decisionStatus: args.bootstrapDecision.decisionStatus,
          rationale: args.bootstrapDecision.rationale
        }
      : undefined,
    task: {
      name: args.task.name ?? undefined,
      notes: args.task.notes,
      assignee: args.task.assignee,
      dueDate: normalizedDueDate
    }
  };
  const parsed =
    changeNoticeImpactTaskCreateRequestValidator.safeParse(request);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsed.error,
          "Invalid Change Notice Impact task request."
        )
      }
    };
  }

  return createAuthorizedChangeNoticeImpactTask({
    client,
    companyId,
    userId,
    task: parsed.data
  });
}

function relationshipRequest(args: {
  decisionId: string;
  targetType: "purchaseOrderLine" | "job" | "jobMaterial";
  targetId: string;
  actionTaskId: string;
}) {
  return {
    decisionId: args.decisionId,
    targetType: args.targetType,
    targetId: args.targetId,
    actionTaskId: args.actionTaskId
  };
}

export async function linkImpactDecisionTask(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    decisionId: string;
    targetType: "purchaseOrderLine" | "job" | "jobMaterial";
    targetId: string;
    actionTaskId: string;
  }
) {
  const parsedArgs = impactTaskRelationshipArgsValidator.safeParse(args);
  if (!parsedArgs.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsedArgs.error,
          "Invalid Change Notice Impact task relationship request."
        )
      }
    };
  }
  const parsed = changeNoticeImpactTaskRelationshipRequestValidator.safeParse(
    relationshipRequest(parsedArgs.data)
  );
  if (!parsed.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsed.error,
          "Invalid Change Notice Impact task relationship request."
        )
      }
    };
  }

  return linkAuthorizedChangeNoticeImpactTask({
    client,
    companyId,
    userId,
    changeNoticeId: parsedArgs.data.changeNoticeId,
    task: parsed.data
  });
}

export async function unlinkImpactDecisionTask(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    decisionId: string;
    targetType: "purchaseOrderLine" | "job" | "jobMaterial";
    targetId: string;
    actionTaskId: string;
  }
) {
  const parsedArgs = impactTaskRelationshipArgsValidator.safeParse(args);
  if (!parsedArgs.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsedArgs.error,
          "Invalid Change Notice Impact task relationship request."
        )
      }
    };
  }
  const parsed = changeNoticeImpactTaskRelationshipRequestValidator.safeParse(
    relationshipRequest(parsedArgs.data)
  );
  if (!parsed.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsed.error,
          "Invalid Change Notice Impact task relationship request."
        )
      }
    };
  }

  return unlinkAuthorizedChangeNoticeImpactTask({
    client,
    companyId,
    userId,
    changeNoticeId: parsedArgs.data.changeNoticeId,
    task: parsed.data
  });
}

export async function designateImpactFollowUpTask(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    changeNoticeId: string;
    decisionId: string;
    targetType: "purchaseOrderLine" | "job" | "jobMaterial";
    targetId: string;
    actionTaskId: string;
  }
) {
  const parsedArgs = impactTaskRelationshipArgsValidator.safeParse(args);
  if (!parsedArgs.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsedArgs.error,
          "Invalid Change Notice Impact task relationship request."
        )
      }
    };
  }
  const parsed = changeNoticeImpactTaskRelationshipRequestValidator.safeParse(
    relationshipRequest(parsedArgs.data)
  );
  if (!parsed.success) {
    return {
      data: null,
      error: {
        message: validationMessage(
          parsed.error,
          "Invalid Change Notice Impact task relationship request."
        )
      }
    };
  }

  return designateAuthorizedChangeNoticeImpactTask({
    client,
    companyId,
    userId,
    changeNoticeId: parsedArgs.data.changeNoticeId,
    task: parsed.data
  });
}
