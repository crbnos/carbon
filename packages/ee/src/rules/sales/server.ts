// Server-side sales-rules evaluator. Cross-app entry point — the ERP quote /
// sales-order line actions call `evaluateSalesRuleLines`. Mirrors
// `../storage/server.ts`.
//
// All functions here are server-only. Never import from a client module.

import type { Database } from "@carbon/database";
import {
  type CompiledRule,
  compileSalesRuleWithCache,
  evaluateRules,
  type ItemFilter,
  ruleAppliesToItem,
  type SalesRuleSurface,
  toItemFilter,
  type Violation
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyHasPlan } from "../../plan.server";
import { itemPostingGroupIdFromEmbed } from "../storage/context";
import { dedupeViolations } from "../storage/server";
import {
  buildSalesRuleLineContext,
  type CustomerCtxInput,
  type SalesRuleItemCtxRow,
  type SalesRuleLineInput
} from "./context";
import { getActiveSalesRulesForItems } from "./service";

// Block/dedupe semantics are identical to storage rules — the
// `@carbon/ee/rules.server` barrel (`../server.ts`) re-exports `isBlocked` /
// `dedupeViolations` from `../storage/server` for both families.

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Plan gate
// ---------------------------------------------------------------------------

export const isSalesRulesEnabledForCompany = (
  client: Client,
  companyId: string
): Promise<boolean> =>
  companyHasPlan(client, companyId, { feature: "SALES_RULES" });

// ---------------------------------------------------------------------------
// Per-line evaluator — single entry point the sales line actions call
// ---------------------------------------------------------------------------

export type EvaluateSalesRuleLinesArgs = {
  client: Client;
  companyId: string;
  userId: string;
  surface: SalesRuleSurface;
  lines: SalesRuleLineInput[];
  /** The sales document's customer. null → no customer ctx is built. */
  customerId: string | null;
  /** The document's ship-to location; resolves `customer.location.countryCode`. */
  customerLocationId: string | null;
};

export type EvaluateSalesRuleLinesResult = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

const EMPTY_RESULT: EvaluateSalesRuleLinesResult = {
  violations: [],
  ruleNames: {}
};

export async function evaluateSalesRuleLines({
  client,
  companyId,
  userId,
  surface,
  lines,
  customerId,
  customerLocationId
}: EvaluateSalesRuleLinesArgs): Promise<EvaluateSalesRuleLinesResult> {
  if (lines.length === 0) {
    return EMPTY_RESULT;
  }
  if (!(await isSalesRulesEnabledForCompany(client, companyId))) {
    return EMPTY_RESULT;
  }

  const itemIds = new Set<string>();
  for (const line of lines) {
    if (line.itemId) itemIds.add(line.itemId);
  }

  const [customerRes, locationRes, itemsRes, rulesRes] = await Promise.all([
    customerId
      ? client
          .from("customer")
          .select("id, customerTypeId, customerStatusId, customFields")
          .eq("id", customerId)
          .eq("companyId", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    customerLocationId
      ? client
          .from("customerLocation")
          .select("id, address(countryCode)")
          .eq("id", customerLocationId)
          .single()
      : Promise.resolve({ data: null, error: null }),
    itemIds.size > 0
      ? client
          .from("item")
          // `itemPostingGroupId` lives on the 1:1 `itemCost` row — embed it
          // so the `item.itemPostingGroupId` rule field + filters resolve.
          // NOTE: `item` has no `customFields` column — custom fields live on
          // the subtype tables (part/material/tool/consumable/service). Selecting
          // it here made PostgREST fail the whole query (42703), which silently
          // produced zero items and skipped every broadcast rule.
          .select(
            "id, readableIdWithRevision, name, type, replenishmentSystem, itemTrackingType, itemCost(itemPostingGroupId)"
          )
          .in("id", Array.from(itemIds))
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null }),
    getActiveSalesRulesForItems(client, companyId, Array.from(itemIds))
  ]);

  const { rules, assignmentsByItemId } = rulesRes;

  // Same reasoning as the item load below: a failed rule fetch returns an empty
  // `rules` array, which reads as "nothing to enforce" and lets the line through.
  if (rulesRes.error) {
    throw new Error(
      `Sales rule evaluation could not load rules: ${
        (rulesRes.error as { message?: string }).message ??
        String(rulesRes.error)
      }`
    );
  }

  // A failed item load must never pass silently. Without item rows every
  // BROADCAST rule is skipped (`!itemForLine` below), so a bad select turns
  // enforcement off with no signal — which is exactly how a missing column
  // went unnoticed. Surface it instead.
  if (itemsRes.error) {
    throw new Error(
      `Sales rule evaluation could not load items: ${
        itemsRes.error.message ?? String(itemsRes.error)
      }`
    );
  }

  // If no active rules exist, nothing can fire.
  if (rules.length === 0) {
    return EMPTY_RESULT;
  }

  // Resolve the ship-to country off the customerLocation → address embed
  // (PostgREST may materialize the 1:1 embed as object or array).
  const countryCode = (() => {
    const row = locationRes.data as { address?: unknown } | null;
    if (!row) return null;
    const address = Array.isArray(row.address) ? row.address[0] : row.address;
    return (
      (address as { countryCode?: string | null } | undefined)?.countryCode ??
      null
    );
  })();

  // Id-only fallback when the customer row lookup missed (RLS, deleted row)
  // keeps `{customer.id}` tokens resolving; unresolved fields then trip
  // required-field semantics. `location` stays undefined — NEVER `{}` — when
  // no country resolves, so `customer.location.countryCode` rules fire their
  // required-field violation.
  const customer: CustomerCtxInput | undefined = customerId
    ? {
        id: customerId,
        customerTypeId: customerRes.data?.customerTypeId ?? null,
        customerStatusId: customerRes.data?.customerStatusId ?? null,
        customFields:
          (customerRes.data?.customFields as
            | Record<string, unknown>
            | null
            | undefined) ?? undefined,
        location: countryCode ? { countryCode } : undefined
      }
    : undefined;

  const itemsById = new Map<string, SalesRuleItemCtxRow>();
  for (const it of itemsRes.data ?? []) {
    const row = it as unknown as Record<string, unknown>;
    const readable = row.readableIdWithRevision as string | null | undefined;
    // Flatten the 1:1 `itemCost` embed's posting group onto the item ctx; drop
    // the nested object. `id` becomes the readable id for token interpolation
    // (mirrors the storage evaluator).
    const { itemCost, ...rest } = row;
    itemsById.set(row.id as string, {
      ...rest,
      id: readable ?? (row.id as string),
      itemPostingGroupId: itemPostingGroupIdFromEmbed(itemCost) ?? undefined,
      customFields:
        (row.customFields as Record<string, unknown> | null | undefined) ??
        undefined
    });
  }

  const compiledById = new Map<string, CompiledRule>();
  const filtersById = new Map<string, ItemFilter>();
  const ruleNamesById = new Map<string, string>();
  for (const rule of rules) {
    compiledById.set(rule.id, compileSalesRuleWithCache(rule));
    filtersById.set(rule.id, toItemFilter(rule));
    ruleNamesById.set(rule.id, rule.name);
  }

  const violations: Violation[] = [];
  for (const line of lines) {
    const explicit = line.itemId
      ? assignmentsByItemId.get(line.itemId)
      : undefined;
    // Keyed by real item id; ctx `id` is the readable id.
    const itemForLine = line.itemId ? itemsById.get(line.itemId) : undefined;

    // Per-line rule set: explicit assignments fire unconditionally; broadcasts
    // are gated per item by the rule's type/group filters (empty filters =
    // every item). A line whose item row didn't load can't match a broadcast
    // (mirrors the storage evaluator) — only its explicit assignments fire.
    const compiledForLine: CompiledRule[] = [];
    for (const rule of rules) {
      const isExplicit = explicit?.has(rule.id) ?? false;
      if (!isExplicit) {
        if (!itemForLine) continue;
        const filter = filtersById.get(rule.id) ?? {};
        if (!ruleAppliesToItem(itemForLine, filter)) continue;
      }
      compiledForLine.push(compiledById.get(rule.id)!);
    }

    if (compiledForLine.length === 0) continue;

    const ctx = buildSalesRuleLineContext({
      line,
      surface,
      userId,
      item: itemForLine,
      customer
    });

    const ruleViolations = evaluateRules(compiledForLine, ctx, surface);
    for (let i = 0; i < ruleViolations.length; i++) {
      // Stamp the originating line so a document-level gate can attribute the
      // violation and deep-link to it.
      violations.push({ ...ruleViolations[i]!, lineId: line.lineId });
    }
  }

  const deduped = dedupeViolations(violations);
  if (deduped.length === 0) {
    return { violations: deduped, ruleNames: {} };
  }

  // Names come off the already-loaded rule rows — no second query.
  const ruleNames: Record<string, string> = {};
  for (let i = 0; i < deduped.length; i++) {
    const ruleId = deduped[i]!.ruleId;
    const name = ruleNamesById.get(ruleId);
    if (name) ruleNames[ruleId] = name;
  }

  return { violations: deduped, ruleNames };
}

// ---------------------------------------------------------------------------
// Document evaluator — the terminal-gate entry point
// ---------------------------------------------------------------------------

export type SalesDocumentType = "salesRfq" | "quote" | "salesOrder";

export type EvaluateSalesRulesForSalesDocumentArgs = {
  client: Client;
  companyId: string;
  userId: string;
  documentType: SalesDocumentType;
  documentId: string;
};

/**
 * Resolve the ship-to location a sales order actually delivers to.
 *
 * A drop shipment overrides the header: the goods go to the drop-ship customer
 * location, not the ordering customer's. Evaluating the header alone would
 * clear an order that ships somewhere else entirely — which defeats any rule
 * keyed on `customer.location.countryCode`.
 */
export async function resolveSalesOrderShipTo(
  client: Client,
  salesOrderId: string,
  companyId: string
): Promise<{ customerId: string | null; customerLocationId: string | null }> {
  const [orderRes, shipmentRes] = await Promise.all([
    client
      .from("salesOrder")
      .select("customerId, customerLocationId")
      .eq("id", salesOrderId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("salesOrderShipment")
      .select("dropShipment, customerId, customerLocationId")
      .eq("id", salesOrderId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  // This resolves WHERE the goods go, which is what country rules gate on.
  // Guessing on a failed read would evaluate the wrong destination.
  if (orderRes.error || shipmentRes.error) {
    const err = orderRes.error ?? shipmentRes.error;
    throw new Error(
      `Sales rule evaluation could not resolve the ship-to for ${salesOrderId}: ${
        (err as { message?: string })?.message ?? String(err)
      }`
    );
  }

  const shipment = shipmentRes.data;
  if (shipment?.dropShipment) {
    // A drop shipment's real destination is the shipment's, never the header's.
    // If it is missing we return null rather than falling back: the header
    // address is a DIFFERENT country, so falling back would silently clear a
    // rule that should have blocked. Null flows into the engine's required-field
    // semantics and surfaces "Customer location is required" at the rule's
    // severity. (The form validator requires the pair, but the column is
    // nullable, so API and legacy rows can still reach here without it.)
    return {
      customerId: shipment.customerId ?? orderRes.data?.customerId ?? null,
      customerLocationId: shipment.customerLocationId ?? null
    };
  }

  return {
    customerId: orderRes.data?.customerId ?? null,
    customerLocationId: orderRes.data?.customerLocationId ?? null
  };
}

/**
 * Evaluate every item-bearing line on a sales document, using the context as it
 * stands right now.
 *
 * This is the terminal-gate counterpart to `evaluateSalesRuleLines`: rather than
 * trusting that each line was checked when it was written, it re-reads the
 * whole document. That covers lines created by paths that never ran the
 * per-line check (conversions, duplication, integrations, the API) and catches
 * staleness — a rule authored later, a ship-to that changed, an item whose
 * attributes moved.
 *
 * Returned violations carry `lineId`, so callers can attribute them.
 */
export async function evaluateSalesRulesForSalesDocument({
  client,
  companyId,
  userId,
  documentType,
  documentId
}: EvaluateSalesRulesForSalesDocumentArgs): Promise<EvaluateSalesRuleLinesResult> {
  if (!(await isSalesRulesEnabledForCompany(client, companyId))) {
    return EMPTY_RESULT;
  }

  // A sales RFQ has no surface of its own — its lines are evaluated under
  // `quoteLine`, because converting is precisely what turns them into quote
  // lines. Only lines that already carry an item can be evaluated: convert
  // mints placeholder items for the rest, and a just-created item has no rule
  // assignments and only default attributes, so nothing could fire on it.
  if (documentType === "salesRfq") {
    const [rfqRes, linesRes] = await Promise.all([
      client
        .from("salesRfq")
        .select("customerId, customerLocationId")
        .eq("id", documentId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("salesRfqLine")
        .select("id, itemId, quantity")
        .eq("salesRfqId", documentId)
        .eq("companyId", companyId)
    ]);

    const lines: SalesRuleLineInput[] = (linesRes.data ?? [])
      .filter((l) => !!l.itemId)
      .map((l) => ({
        lineId: l.id,
        itemId: l.itemId,
        quantity: Math.max(1, ...(l.quantity ?? [1]))
      }));

    return evaluateSalesRuleLines({
      client,
      companyId,
      userId,
      surface: "quoteLine",
      lines,
      customerId: rfqRes.data?.customerId ?? null,
      customerLocationId: rfqRes.data?.customerLocationId ?? null
    });
  }

  if (documentType === "quote") {
    const [quoteRes, linesRes] = await Promise.all([
      client
        .from("quote")
        .select("customerId, customerLocationId")
        .eq("id", documentId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("quoteLine")
        .select("id, itemId, quantity")
        .eq("quoteId", documentId)
        .eq("companyId", companyId)
    ]);

    const lines: SalesRuleLineInput[] = (linesRes.data ?? [])
      .filter((l) => !!l.itemId)
      .map((l) => ({
        lineId: l.id,
        itemId: l.itemId,
        // A quote line carries an array of quantity breaks. Evaluate the
        // largest — it is the one most likely to trip a `gt` threshold, so
        // this is the conservative choice.
        quantity: Math.max(1, ...(l.quantity ?? [1]))
      }));

    return evaluateSalesRuleLines({
      client,
      companyId,
      userId,
      surface: "quoteLine",
      lines,
      customerId: quoteRes.data?.customerId ?? null,
      customerLocationId: quoteRes.data?.customerLocationId ?? null
    });
  }

  const [shipTo, linesRes] = await Promise.all([
    resolveSalesOrderShipTo(client, documentId, companyId),
    client
      .from("salesOrderLine")
      .select("id, itemId, saleQuantity")
      .eq("salesOrderId", documentId)
      .eq("companyId", companyId)
  ]);

  const lines: SalesRuleLineInput[] = (linesRes.data ?? [])
    .filter((l) => !!l.itemId)
    .map((l) => ({
      lineId: l.id,
      itemId: l.itemId,
      quantity: l.saleQuantity ?? 1
    }));

  return evaluateSalesRuleLines({
    client,
    companyId,
    userId,
    surface: "salesOrderLine",
    lines,
    customerId: shipTo.customerId,
    customerLocationId: shipTo.customerLocationId
  });
}
