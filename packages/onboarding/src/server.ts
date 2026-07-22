// Server-only DB helpers for the Implementation Hub. Each takes the supabase
// client as its first arg and returns the raw { data, error } (does not throw),
// matching Carbon's service convention. The enrollment + structural writes are
// authorized at the route (isInternal / requirePermissions); RLS is the backstop.
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_EXCLUSIONS, TEMPLATE_KEY, TEMPLATE_VERSION } from "./content";
import type { IntakeAnswers } from "./content/intake";
import { GO_LIVE_STEP_KEY } from "./content/spine";
import type { Signals } from "./logic";
import {
  complexityBand,
  complexityFlags,
  gateDateKey,
  INTAKE_COLLECTION,
  INTAKE_TRANSCRIPT_COLLECTION,
  parseIntakeRows
} from "./logic";
import type { IntakeRowPayload } from "./models";
import type {
  HubContacts,
  HubExclusions,
  HubStatus,
  ImplementationRowData,
  StateKind,
  Tier
} from "./types";

type Client = SupabaseClient<Database>;

export function getImplementationHub(client: Client, companyId: string) {
  return client
    .from("implementationHub")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
}

export function getImplementationCheckStates(
  client: Client,
  companyId: string
) {
  return client
    .from("implementationCheckState")
    .select("itemKey, kind, value")
    .eq("companyId", companyId);
}

export function getImplementationFieldValues(
  client: Client,
  companyId: string
) {
  return client
    .from("implementationFieldValue")
    .select("fieldKey, value")
    .eq("companyId", companyId);
}

export function getImplementationRows(client: Client, companyId: string) {
  return client
    .from("implementationRow")
    .select("id, collection, payload, sortOrder")
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
}

// Cheap existence probes that back the nested product steps' auto-detection.
// Never persisted — overlaid on stored manual state at read time.
export async function detectImplementationSignals(
  client: Client,
  companyId: string
): Promise<Signals> {
  const probe = (
    table:
      | "item"
      | "makeMethod"
      | "job"
      | "salesOrder"
      | "trackedEntity"
      | "customer"
      | "supplier"
      | "workCenter"
      | "methodMaterial"
      | "shipment"
      | "productionEvent"
  ) => client.from(table).select("id").eq("companyId", companyId).limit(1);

  const [
    items,
    methods,
    jobs,
    orders,
    tracked,
    customers,
    suppliers,
    workCenters,
    bomLines,
    shipments,
    productionEvents
  ] = await Promise.all([
    probe("item"),
    probe("makeMethod"),
    probe("job"),
    probe("salesOrder"),
    probe("trackedEntity"),
    probe("customer"),
    probe("supplier"),
    probe("workCenter"),
    probe("methodMaterial"),
    probe("shipment"),
    probe("productionEvent")
  ]);

  return {
    hasItems: !!items.data?.length,
    hasMakeMethod: !!methods.data?.length,
    hasJob: !!jobs.data?.length,
    hasSalesOrder: !!orders.data?.length,
    hasTrackedEntity: !!tracked.data?.length,
    hasCustomers: !!customers.data?.length,
    hasSuppliers: !!suppliers.data?.length,
    hasWorkCenter: !!workCenters.data?.length,
    hasBomLines: !!bomLines.data?.length,
    hasShipment: !!shipments.data?.length,
    hasProductionEvent: !!productionEvents.data?.length
  };
}

export function enrollImplementation(
  client: Client,
  args: { companyId: string; userId: string; tier?: Tier }
) {
  return client
    .from("implementationHub")
    .insert({
      id: args.companyId,
      tier: args.tier ?? "self_serve",
      status: "tailoring",
      templateKey: TEMPLATE_KEY,
      templateVersion: TEMPLATE_VERSION,
      // New hubs start with all optional pages/sections excluded; Carbon opts
      // them back in per customer from Setup & Controls.
      exclusions: DEFAULT_EXCLUSIONS,
      createdBy: args.userId
    } as never)
    .select("id")
    .single();
}

export function upsertCheckState(
  client: Client,
  args: {
    companyId: string;
    itemKey: string;
    kind: StateKind;
    value: string;
    userId: string;
  }
) {
  return client
    .from("implementationCheckState")
    .upsert(
      {
        companyId: args.companyId,
        itemKey: args.itemKey,
        kind: args.kind,
        value: args.value,
        createdBy: args.userId,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      },
      { onConflict: "companyId, itemKey" }
    )
    .select("id")
    .single();
}

export function upsertCheckStates(
  client: Client,
  args: {
    companyId: string;
    itemKeys: string[];
    kind: StateKind;
    value: string;
    userId: string;
  }
) {
  const updatedAt = new Date().toISOString();
  // Dedupe: ON CONFLICT DO UPDATE cannot affect the same row twice in one
  // statement, so a repeated key would fail the whole batch.
  return client.from("implementationCheckState").upsert(
    Array.from(new Set(args.itemKeys)).map((itemKey) => ({
      companyId: args.companyId,
      itemKey,
      kind: args.kind,
      value: args.value,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt
    })),
    { onConflict: "companyId, itemKey" }
  );
}

export function upsertFieldValue(
  client: Client,
  args: { companyId: string; fieldKey: string; value: string; userId: string }
) {
  return client
    .from("implementationFieldValue")
    .upsert(
      {
        companyId: args.companyId,
        fieldKey: args.fieldKey,
        value: args.value,
        createdBy: args.userId,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      },
      { onConflict: "companyId, fieldKey" }
    )
    .select("id")
    .single();
}

export function insertImplementationRow(
  client: Client,
  args: {
    companyId: string;
    collection: string;
    payload: unknown;
    sortOrder?: number;
    userId: string;
  }
) {
  return client
    .from("implementationRow")
    .insert({
      companyId: args.companyId,
      collection: args.collection,
      payload: args.payload as never,
      sortOrder: args.sortOrder ?? 0,
      createdBy: args.userId
    })
    .select("id")
    .single();
}

export function updateImplementationRow(
  client: Client,
  args: {
    id: string;
    companyId: string;
    payload: unknown;
    userId: string;
  }
) {
  return client
    .from("implementationRow")
    .update({
      payload: args.payload as never,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId);
}

export function deleteImplementationRow(
  client: Client,
  args: { id: string; companyId: string }
) {
  return client
    .from("implementationRow")
    .delete()
    .eq("id", args.id)
    .eq("companyId", args.companyId);
}

export function updateImplementationHub(
  client: Client,
  companyId: string,
  patch: {
    tier?: Tier;
    status?: HubStatus;
    exclusions?: HubExclusions;
    contacts?: HubContacts;
    signedAt?: string | null;
    signedBy?: string | null;
    templateVersion?: number;
    userId: string;
  }
) {
  const { userId, ...rest } = patch;
  return client
    .from("implementationHub")
    .update({
      ...rest,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    } as never)
    .eq("id", companyId);
}

// ---------------------------------------------------------------------------
// Intake ("Tell Us How You Run") — versioned snapshot rows + transcripts.
// ---------------------------------------------------------------------------

export function getImplementationRowsByCollection(
  client: Client,
  companyId: string,
  collection: string
) {
  return client
    .from("implementationRow")
    .select("id, collection, payload, sortOrder")
    .eq("companyId", companyId)
    .eq("collection", collection)
    .order("sortOrder", { ascending: true });
}

// Save (or start) the wizard's resumable draft. Answers only ever accumulate
// into the draft row — nothing existing is touched until completion.
export async function saveIntakeDraft(
  client: Client,
  args: { companyId: string; userId: string; answers: IntakeAnswers }
) {
  const rows = await getImplementationRowsByCollection(
    client,
    args.companyId,
    INTAKE_COLLECTION
  );
  if (rows.error) return { data: null, error: rows.error };

  const state = parseIntakeRows(
    (rows.data ?? []) as unknown as ImplementationRowData[]
  );
  const payload: IntakeRowPayload = {
    version: state.draft?.payload.version ?? state.nextVersion,
    status: "draft",
    answers: args.answers
  };

  if (state.draft) {
    return updateImplementationRow(client, {
      id: state.draft.rowId,
      companyId: args.companyId,
      payload,
      userId: args.userId
    });
  }
  return insertImplementationRow(client, {
    companyId: args.companyId,
    collection: INTAKE_COLLECTION,
    payload,
    sortOrder: payload.version,
    userId: args.userId
  });
}

// Complete the intake: snapshot the answers as the new current version, mark
// Phase 1's gate/steps done, seed the go-live date into the timeline, and
// record the owner. Sequential idempotent writes — re-completing is safe.
export async function completeIntake(
  client: Client,
  args: { companyId: string; userId: string; answers: IntakeAnswers }
) {
  const rows = await getImplementationRowsByCollection(
    client,
    args.companyId,
    INTAKE_COLLECTION
  );
  if (rows.error) return { data: null, error: rows.error };
  const state = parseIntakeRows(
    (rows.data ?? []) as unknown as ImplementationRowData[]
  );

  const payload: IntakeRowPayload = {
    version: state.draft?.payload.version ?? state.nextVersion,
    status: "completed",
    answers: args.answers,
    band: complexityBand(args.answers),
    flags: complexityFlags(args.answers).map((f) => f.key),
    completedAt: new Date().toISOString()
  };

  const saved = state.draft
    ? await updateImplementationRow(client, {
        id: state.draft.rowId,
        companyId: args.companyId,
        payload,
        userId: args.userId
      })
    : await insertImplementationRow(client, {
        companyId: args.companyId,
        collection: INTAKE_COLLECTION,
        payload,
        sortOrder: payload.version,
        userId: args.userId
      });
  if (saved.error) return { data: null, error: saved.error };

  // Phase 1's gate + the wizard-owned steps complete themselves — the product
  // verifies its own work; there is nothing for the customer to tick.
  const done: { itemKey: string; kind: StateKind }[] = [
    { itemKey: "gate:intake", kind: "gate" },
    { itemKey: "prod:intake-answers", kind: "productStep" },
    { itemKey: "prod:intake-commit", kind: "productStep" },
    { itemKey: "task:intake-answers", kind: "task" },
    { itemKey: "task:intake-commit", kind: "task" }
  ];
  for (const item of done) {
    const result = await upsertCheckState(client, {
      companyId: args.companyId,
      itemKey: item.itemKey,
      kind: item.kind,
      value: "done",
      userId: args.userId
    });
    if (result.error) return { data: null, error: result.error };
  }

  // The go-live date anchors the countdown + timeline (the switch gate's date).
  if (args.answers.goLiveDate) {
    const result = await upsertFieldValue(client, {
      companyId: args.companyId,
      fieldKey: gateDateKey(GO_LIVE_STEP_KEY),
      value: args.answers.goLiveDate,
      userId: args.userId
    });
    if (result.error) return { data: null, error: result.error };
  }

  // Record the owner on the hub contacts (merged, not replaced).
  if (args.answers.ownerName || args.answers.ownerEmail) {
    const hub = await getImplementationHub(client, args.companyId);
    if (hub.error) return { data: null, error: hub.error };
    const contacts =
      ((hub.data?.contacts as unknown as HubContacts) ?? {}) satisfies HubContacts;
    const result = await updateImplementationHub(client, args.companyId, {
      contacts: {
        ...contacts,
        owner: args.answers.ownerName ?? contacts.owner,
        ownerEmail: args.answers.ownerEmail ?? contacts.ownerEmail
      },
      status: "active",
      userId: args.userId
    });
    if (result.error) return { data: null, error: result.error };
  }

  return { data: { version: payload.version }, error: null };
}

// Persist a voice utterance or AI-clarifier exchange — Carbon's sales team
// reads these later, so every one is kept.
export async function insertIntakeTranscript(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    questionKey: string;
    source: "voice" | "clarifier";
    transcript: string;
  }
) {
  const rows = await getImplementationRowsByCollection(
    client,
    args.companyId,
    INTAKE_COLLECTION
  );
  const state = parseIntakeRows(
    (rows.data ?? []) as unknown as ImplementationRowData[]
  );
  const intakeVersion =
    state.draft?.payload.version ??
    state.current?.payload.version ??
    state.nextVersion;

  return insertImplementationRow(client, {
    companyId: args.companyId,
    collection: INTAKE_TRANSCRIPT_COLLECTION,
    payload: {
      intakeVersion,
      questionKey: args.questionKey,
      source: args.source,
      transcript: args.transcript
    },
    userId: args.userId
  });
}

// Reset a hub enrolled under an older template to the current one: wipe the
// per-company state layer and start the journey at Phase 1. Chase-approved for
// the v1 → v2 move; runs lazily (and idempotently) from the layout loader with
// the service-role client.
export async function resetImplementationForTemplate(
  serviceRole: Client,
  args: { companyId: string; userId: string }
) {
  const tables = [
    "implementationCheckState",
    "implementationFieldValue",
    "implementationRow"
  ] as const;
  for (const table of tables) {
    const result = await serviceRole
      .from(table)
      .delete()
      .eq("companyId", args.companyId);
    if (result.error) return { data: null, error: result.error };
  }
  const updated = await updateImplementationHub(serviceRole, args.companyId, {
    templateVersion: TEMPLATE_VERSION,
    status: "tailoring",
    userId: args.userId
  });
  if (updated.error) return { data: null, error: updated.error };
  return { data: { reset: true }, error: null };
}
