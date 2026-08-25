import type { Database } from "@carbon/database";
import { trigger } from "@carbon/lib/trigger";
import {
  NotificationDestination,
  NotificationEvent
} from "@carbon/notifications";
import type { ActionOutcome, RuntimeValue } from "@carbon/workflows";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

const DESTINATIONS = new Set<string>(Object.values(NotificationDestination));

function entityId(value: RuntimeValue | undefined): string | undefined {
  return value?.kind === "entity" && value.id ? value.id : undefined;
}

function text(value: RuntimeValue | undefined): string | undefined {
  if (value?.kind !== "primitive" || value.value === null) return undefined;
  const rendered = String(value.value);
  return rendered === "" ? undefined : rendered;
}

/**
 * The channels the customer ticked, or undefined to leave the notify job on its default
 * map for this event. A name the job would not recognise is dropped rather than passed
 * on — an unknown destination is silently ignored there, so it would read as delivered.
 */
function channels(
  value: RuntimeValue | undefined
): NotificationDestination[] | undefined {
  if (value?.kind !== "list") return undefined;
  const picked = value.items
    .map((item) => (item.kind === "primitive" ? String(item.value) : ""))
    .filter((name) => DESTINATIONS.has(name)) as NotificationDestination[];
  return picked.length > 0 ? [...new Set(picked)] : undefined;
}

/** `subject` and `message` arrive already rendered, so nothing here reads a template. */
export async function runNotifyAction(params: {
  companyId: string;
  runId: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome> {
  const { companyId, inputs, runId } = params;

  // A role IS a group, and every user has an identity group whose id is their user
  // id — so one group recipient covers both inputs without branching.
  const groupIds = [entityId(inputs.user), entityId(inputs.role)].filter(
    (id): id is string => id !== undefined
  );
  if (groupIds.length === 0) {
    return { ok: false, error: "This step has nobody to notify." };
  }

  const aboutId = text(inputs.aboutId);
  const aboutType = text(inputs.aboutType);
  const destinations = channels(inputs.channels);

  await trigger("notify", {
    body: text(inputs.message),
    companyId,
    // Omitted rather than empty: the job reads an absent field as "use the default map",
    // which is what a node saved before this input existed still means.
    ...(destinations ? { destinations } : {}),
    // The run stands in as the subject when the customer named no record.
    documentId: aboutId ?? runId,
    // The payload type is the approval enum; the column is TEXT and the link
    // resolver reads the workflow entity name.
    ...(aboutId && aboutType
      ? { documentType: aboutType as ApprovalDocumentType }
      : {}),
    event: NotificationEvent.Workflow,
    // No `from`: the notify job drops the sender from the recipients, and a workflow is
    // not the owner acting — it merely runs as them. Naming them here silently delivered
    // nothing for "notify me when X happens" while still reporting success.
    recipient: { type: "group", groupIds },
    title: text(inputs.subject)
  });

  return {
    ok: true,
    outputs: {},
    // trigger only queues — it reports nothing about delivery.
    summary: `Notified ${groupIds.length} recipient(s).`
  };
}
