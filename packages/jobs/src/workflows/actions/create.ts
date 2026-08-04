import {
  type ActionOutcome,
  entityValue,
  type RuntimeValue
} from "@carbon/workflows";
import type { DispatchContext, WorkflowDispatch } from "./dispatcher";
import { toPlainValue } from "./values";

const UNREADABLE = "The record was created but could not be read back.";
const FAILED = "That record could not be created.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return FAILED;
}

/** The id of the row a service function returned, whether it came back alone or in a list. */
function idIn(payload: unknown): string | undefined {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const id = idIn(entry);
      if (id !== undefined) return id;
    }
    return undefined;
  }
  if (!isRecord(payload)) return undefined;
  return typeof payload.id === "string" ? payload.id : undefined;
}

/** Creates a record through the ERP's own upsert service function, so sequence
 * numbers, defaults and required-field logic are the ones the app already uses. */
export async function runCreateAction(params: {
  dispatch: WorkflowDispatch;
  context: DispatchContext;
  call: string;
  entity: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome> {
  const { dispatch, context, call, entity, inputs } = params;

  const args: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(inputs)) {
    const plain = toPlainValue(value);
    if (plain === null || plain === undefined) continue;
    args[name] = plain;
  }

  // companyId, createdBy and updatedBy are stamped by the dispatcher.
  const result = await dispatch(call, context, args);
  if (!result.success) return { ok: false, error: messageOf(result.error) };

  // Service functions usually return a Supabase envelope, which carries its own error.
  const envelope = isRecord(result.data) ? result.data : undefined;
  if (envelope?.error !== undefined && envelope.error !== null) {
    return { ok: false, error: messageOf(envelope.error) };
  }

  const id = idIn(
    envelope !== undefined && "data" in envelope ? envelope.data : result.data
  );
  if (id === undefined) return { ok: false, error: UNREADABLE };

  return {
    ok: true,
    outputs: { record: entityValue(entity, id) },
    summary: `Created ${id}.`
  };
}
