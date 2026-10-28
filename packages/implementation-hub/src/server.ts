// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Server-only DB helpers for the Implementation Hub. Each takes the supabase
// client as its first arg and returns the raw { data, error } (does not throw),
// matching Carbon's service convention. The enrollment + structural writes are
// authorized at the route (isInternal / requirePermissions); RLS is the backstop.
import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_EXCLUSIONS, TEMPLATE_KEY, TEMPLATE_VERSION } from "./content";
import { STEP_ORDER } from "./content/dependencies";
import {
  ONBOARDING_COUNT_KEYS,
  type OnboardingCountKey,
  type OnboardingCountResult,
  type Signals,
  summarizeHubProgress,
  summarizeOnboardingCounts
} from "./logic";
import { buildHubPlan, type Label } from "./logic/hub-plan";
import { EMPTY_EXCLUSIONS } from "./logic/visibility";
import type {
  CheckStateRow,
  HubContacts,
  HubExclusions,
  HubStatus,
  ImplementationRowData,
  Source,
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
    .select(
      "itemKey, kind, value, source, updatedBy, updatedAt, verifiedAt, verifiedBy"
    )
    .eq("companyId", companyId);
}

export function getImplementationAssignments(
  client: Client,
  companyId: string
) {
  return client
    .from("implementationAssignment")
    .select("itemKey, assigneeId")
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
    .select("id, collection, payload, sortOrder, source, sourceRef")
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
}

// The people with a hub page, each with the page Carbon staff loaded for them.
export function getImplementationMembers(client: Client, companyId: string) {
  return client
    .from("implementationMember")
    .select("userId, page, updatedAt")
    .eq("companyId", companyId);
}

export function upsertImplementationMember(
  client: Client,
  args: {
    companyId: string;
    memberId: string;
    page: unknown;
    userId: string;
  }
) {
  return client.from("implementationMember").upsert(
    {
      companyId: args.companyId,
      userId: args.memberId,
      page: args.page as never,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "companyId, userId" }
  );
}

export function deleteImplementationMember(
  client: Client,
  args: { companyId: string; memberId: string }
) {
  return client
    .from("implementationMember")
    .delete()
    .eq("companyId", args.companyId)
    .eq("userId", args.memberId);
}

// Cheap existence probes that back the nested product steps' auto-detection.
// Never persisted — overlaid on stored manual state at read time.
//
// `known` skips a probe: pass the signals already seen true (the app caches
// them), since "this company has a part" does not stop being true from one
// page load to the next.
export async function detectImplementationSignals(
  client: Client,
  companyId: string,
  known: Partial<Signals> = {}
): Promise<Signals> {
  const probe = async (
    signal: keyof Signals,
    table: "item" | "makeMethod" | "job" | "salesOrder" | "trackedEntity"
  ) => {
    if (known[signal]) return true;
    const result = await client
      .from(table)
      .select("id")
      .eq("companyId", companyId)
      .limit(1);
    return !!result.data?.length;
  };

  const [hasItems, hasMakeMethod, hasJob, hasSalesOrder, hasTrackedEntity] =
    await Promise.all([
      probe("hasItems", "item"),
      probe("hasMakeMethod", "makeMethod"),
      probe("hasJob", "job"),
      probe("hasSalesOrder", "salesOrder"),
      probe("hasTrackedEntity", "trackedEntity")
    ]);

  return { hasItems, hasMakeMethod, hasJob, hasSalesOrder, hasTrackedEntity };
}

// The setup counts: how many records of each kind the company has, for the
// hub's evidence and for an agent over MCP. Head queries only, never rows. They
// run on the caller's client, so RLS and API-key scopes apply: zero can also
// mean the credential has no permission for that module. A failed read is null
// and listed in `unavailable`, never reported as zero.
export async function getSetupCounts(client: Client, companyId: string) {
  const head = (
    table:
      | "location"
      | "process"
      | "workCenter"
      | "supplierProcess"
      | "supplier"
      | "customer"
      | "item"
      | "storageUnit"
      | "methodMaterial"
      | "methodOperation"
      | "job"
  ) =>
    client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId);

  const itemsOfType = (type: "Part" | "Material" | "Tool" | "Consumable") =>
    client
      .from("item")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("type", type);

  // Keyed by count, so the compiler catches a missing or misnamed query.
  const queries: Record<
    OnboardingCountKey,
    PromiseLike<OnboardingCountResult>
  > = {
    locations: head("location"),
    processes: head("process"),
    workCenters: head("workCenter"),
    supplierProcesses: head("supplierProcess"),
    activeEmployees: client
      .from("employee")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("active", true),
    suppliers: head("supplier"),
    customers: head("customer"),
    items: head("item"),
    parts: itemsOfType("Part"),
    materials: itemsOfType("Material"),
    tools: itemsOfType("Tool"),
    consumables: itemsOfType("Consumable"),
    storageUnits: head("storageUnit"),
    bomLines: head("methodMaterial"),
    routingOperations: head("methodOperation"),
    // Sent at some point: a quote that was ordered, lost or expired still was.
    quotesSent: client
      .from("quote")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .not("status", "in", '("Draft","Cancelled")'),
    salesOrders: client
      .from("salesOrder")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .not("status", "in", '("Draft","Needs Approval","Cancelled")'),
    // Finalized purchase orders only: a return or an outside-processing order
    // is not a first purchase.
    purchaseOrdersFinalized: client
      .from("purchaseOrder")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("purchaseOrderType", "Purchase")
      .in("status", [
        "To Receive",
        "To Receive and Invoice",
        "To Invoice",
        "Completed",
        "Closed"
      ]),
    postedReceipts: client
      .from("receipt")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("status", "Posted"),
    jobs: head("job"),
    // Released at some point: a completed or closed job still counts.
    jobsReleased: client
      .from("job")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .not("status", "in", '("Draft","Planned","Cancelled")'),
    operationsDone: client
      .from("jobOperation")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("status", "Done"),
    // Closing a job follows completing it, so both count.
    completedJobs: client
      .from("job")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
      .in("status", ["Completed", "Closed"])
      .gt("quantityComplete", 0)
  };

  const counted = await Promise.all(
    ONBOARDING_COUNT_KEYS.map(async (key) => [key, await queries[key]] as const)
  );
  return summarizeOnboardingCounts(Object.fromEntries(counted));
}

// The hub-status read: everything in the hub in one call, as an agent reads it
// over MCP. Enrollment, tier and progress, the setup counts, and the plan (every
// gate with its tasks, the Setup Map rows, objectives and custom rows), each
// with the item key the hub write tools take. `label` turns template messages
// into text (the ERP passes its English catalog); `stepOrder` is the setup
// order the onboarding playbook follows. `unavailable` lists every part that
// could not be read, so a failed read is never mistaken for an empty hub.
export async function getHubStatus(
  client: Client,
  companyId: string,
  options: { label?: Label } = {}
) {
  const [hub, hubStates, fieldValues, rows, assignments, setupCounts] =
    await Promise.all([
      client
        .from("implementationHub")
        .select("tier, status, layout, templateVersion, exclusions, contacts")
        .eq("id", companyId)
        .maybeSingle(),
      getImplementationCheckStates(client, companyId),
      getImplementationFieldValues(client, companyId),
      getImplementationRows(client, companyId),
      getImplementationAssignments(client, companyId),
      getSetupCounts(client, companyId)
    ]);

  const hubFailed = Boolean(
    hub.error ||
      hubStates.error ||
      fieldValues.error ||
      rows.error ||
      assignments.error
  );

  const base = {
    counts: setupCounts.counts,
    stepOrder: STEP_ORDER,
    unavailable: [...(hubFailed ? ["hub"] : []), ...setupCounts.unavailable]
  };

  if (hubFailed)
    return { data: { hub: { enrolled: null }, ...base }, error: null };
  if (!hub.data)
    return { data: { hub: { enrolled: false }, ...base }, error: null };

  const checkStates = (hubStates.data ?? []) as CheckStateRow[];
  const plan = buildHubPlan({
    tier: hub.data.tier as Tier,
    exclusions:
      (hub.data.exclusions as unknown as HubExclusions) ?? EMPTY_EXCLUSIONS,
    checkStates,
    fieldValues: fieldValues.data ?? [],
    rows: (rows.data ?? []) as unknown as ImplementationRowData[],
    assignments: assignments.data ?? [],
    counts: setupCounts.counts,
    label: options.label
  });

  return {
    data: {
      hub: {
        enrolled: true,
        tier: hub.data.tier,
        status: hub.data.status,
        layout: hub.data.layout,
        templateVersion: hub.data.templateVersion,
        contacts: hub.data.contacts,
        ...summarizeHubProgress(checkStates)
      },
      plan,
      ...base
    },
    error: null
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

// A tick records who wrote it. A new value is no longer the value staff
// verified, so writing a tick always clears the verification.
export function upsertCheckState(
  client: Client,
  args: {
    companyId: string;
    itemKey: string;
    kind: StateKind;
    value: string;
    userId: string;
    source: Source;
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
        source: args.source,
        verifiedAt: null,
        verifiedBy: null,
        createdBy: args.userId,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
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
    source: Source;
  }
) {
  const updatedAt = datetime.timestamp();
  // Dedupe: ON CONFLICT DO UPDATE cannot affect the same row twice in one
  // statement, so a repeated key would fail the whole batch.
  return client.from("implementationCheckState").upsert(
    Array.from(new Set(args.itemKeys)).map((itemKey) => ({
      companyId: args.companyId,
      itemKey,
      kind: args.kind,
      value: args.value,
      source: args.source,
      verifiedAt: null,
      verifiedBy: null,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt
    })),
    { onConflict: "companyId, itemKey" }
  );
}

// Stamp (or clear) the staff verification on the given ticks. Only rows that
// exist are touched: an item nobody ticked has nothing to verify.
export function setCheckStatesVerified(
  client: Client,
  args: {
    companyId: string;
    itemKeys: string[];
    userId: string;
    verified: boolean;
  }
) {
  return client
    .from("implementationCheckState")
    .update(
      args.verified
        ? { verifiedAt: datetime.timestamp(), verifiedBy: args.userId }
        : { verifiedAt: null, verifiedBy: null }
    )
    .eq("companyId", args.companyId)
    .in("itemKey", Array.from(new Set(args.itemKeys)));
}

export function getImplementationAssignment(
  client: Client,
  args: { companyId: string; itemKey: string }
) {
  return client
    .from("implementationAssignment")
    .select("assigneeId")
    .eq("companyId", args.companyId)
    .eq("itemKey", args.itemKey)
    .maybeSingle();
}

export function upsertImplementationAssignment(
  client: Client,
  args: {
    companyId: string;
    itemKey: string;
    assigneeId: string;
    userId: string;
  }
) {
  return client.from("implementationAssignment").upsert(
    {
      companyId: args.companyId,
      itemKey: args.itemKey,
      assigneeId: args.assigneeId,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "companyId, itemKey" }
  );
}

export function deleteImplementationAssignment(
  client: Client,
  args: { companyId: string; itemKey: string }
) {
  return client
    .from("implementationAssignment")
    .delete()
    .eq("companyId", args.companyId)
    .eq("itemKey", args.itemKey);
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
        updatedAt: datetime.timestamp()
      },
      { onConflict: "companyId, fieldKey" }
    )
    .select("id")
    .single();
}

// Removes one field value. Returns the deleted rows: none when nothing was set,
// or when RLS kept the row (deleting needs Settings delete).
export function deleteFieldValue(
  client: Client,
  args: { companyId: string; fieldKey: string }
) {
  return client
    .from("implementationFieldValue")
    .delete()
    .eq("companyId", args.companyId)
    .eq("fieldKey", args.fieldKey)
    .select("id");
}

export function insertImplementationRow(
  client: Client,
  args: {
    companyId: string;
    collection: string;
    payload: unknown;
    sortOrder?: number;
    userId: string;
    source?: Source;
    sourceRef?: string;
  }
) {
  return client
    .from("implementationRow")
    .insert({
      companyId: args.companyId,
      collection: args.collection,
      payload: args.payload as never,
      sortOrder: args.sortOrder ?? 0,
      source: args.source ?? null,
      sourceRef: args.sourceRef ?? null,
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
      updatedAt: datetime.timestamp()
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
      updatedAt: datetime.timestamp()
    } as never)
    .eq("id", companyId);
}

export * from "./apply-mutation";
