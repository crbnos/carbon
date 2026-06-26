// Server-only DB helpers for the Implementation Hub. Each takes the supabase
// client as its first arg and returns the raw { data, error } (does not throw),
// matching Carbon's service convention. The enrollment + structural writes are
// authorized at the route (isInternal / requirePermissions); RLS is the backstop.
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_EXCLUSIONS, TEMPLATE_KEY, TEMPLATE_VERSION } from "./content";
import type { Signals } from "./logic";
import type {
  HubContacts,
  HubExclusions,
  HubStatus,
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
    table: "item" | "makeMethod" | "job" | "salesOrder" | "trackedEntity"
  ) => client.from(table).select("id").eq("companyId", companyId).limit(1);

  const [items, methods, jobs, orders, tracked] = await Promise.all([
    probe("item"),
    probe("makeMethod"),
    probe("job"),
    probe("salesOrder"),
    probe("trackedEntity")
  ]);

  return {
    hasItems: !!items.data?.length,
    hasMakeMethod: !!methods.data?.length,
    hasJob: !!jobs.data?.length,
    hasSalesOrder: !!orders.data?.length,
    hasTrackedEntity: !!tracked.data?.length
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
