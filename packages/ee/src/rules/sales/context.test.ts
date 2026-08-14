// Anti-drift contract test for sales rules. Locks the registry (what the
// sales-rule builder offers) to the runtime code path (what
// `buildSalesRuleLineContext` actually populates) per sales-document surface.
//
// If someone adds a field to SALES_RULE_FIELD_REGISTRY (or widens
// `getFieldsForSalesRules`) without populating it in `buildSalesRuleLineContext`
// / the server SELECTs, or edits SALES_RULE_SURFACE_CONTEXT_AVAILABILITY out of
// sync — one of these assertions fails. Mirrors
// `../storage/context.test.ts`.

import {
  buildResolver,
  type FieldContext,
  getFieldsForSalesRuleSurfaces,
  SALES_RULE_SURFACE_CONTEXT_AVAILABILITY,
  SALES_RULE_SURFACES,
  type SalesRuleSurface
} from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  buildSalesRuleLineContext,
  type CustomerCtxInput,
  type SalesRuleLineInput
} from "./context";

// Fully-populated rows mirroring the shape `evaluateSalesRuleLines` builds
// AFTER its post-query flattening (itemPostingGroupId off itemCost; readable
// id onto `id`; ship-to country onto `customer.location`). Every
// registry-referenced key is present.
const ITEM_ROW = {
  id: "ITEM-1",
  type: "Part",
  replenishmentSystem: "Buy",
  itemTrackingType: "Inventory",
  itemPostingGroupId: "ipg_1"
};
const CUSTOMER_ROW: CustomerCtxInput = {
  id: "cust_1",
  customerTypeId: "ct_1",
  customerStatusId: "cs_1",
  location: { countryCode: "US" }
};

// Sales-rule FieldContext values map 1:1 onto RuleContext root keys (no
// "storage" → "storageUnit" remap on these surfaces).
const ctxRootKeyFor = (context: FieldContext): string => context;

const lineFor = (): SalesRuleLineInput => ({
  lineId: "line_1",
  itemId: ITEM_ROW.id,
  quantity: 5
});

const ctxFor = (surface: SalesRuleSurface) =>
  buildSalesRuleLineContext({
    line: lineFor(),
    surface,
    userId: "user_1",
    item: ITEM_ROW,
    customer: CUSTOMER_ROW
  });

describe("registry ↔ runtime ctx contract (sales rules)", () => {
  for (const surface of SALES_RULE_SURFACES) {
    it(`every field offered on "${surface}" resolves in the runtime ctx`, () => {
      const ctx = ctxFor(surface);
      const offered = getFieldsForSalesRuleSurfaces([surface]);
      expect(offered.length).toBeGreaterThan(0);
      for (const f of offered) {
        expect(
          buildResolver(f.path)(ctx),
          `"${f.path}" offered on "${surface}" but resolved to undefined`
        ).not.toBeUndefined();
      }
    });

    it(`ctx for "${surface}" populates exactly the declared contexts`, () => {
      const ctx = ctxFor(surface) as Record<string, unknown>;
      for (const context of SALES_RULE_SURFACE_CONTEXT_AVAILABILITY[surface]) {
        expect(
          ctx[ctxRootKeyFor(context)],
          `context "${context}" declared available on "${surface}" but not built`
        ).not.toBeUndefined();
      }
      // No storage/workCenter/operation roots may leak into sales-document
      // surfaces — those contexts belong to the storage-rules evaluator.
      expect(ctx.storageUnit).toBeUndefined();
      expect(ctx.workCenter).toBeUndefined();
      expect(ctx.operation).toBeUndefined();
    });
  }
});

describe("customer location semantics", () => {
  it("missing location yields customer.location === undefined", () => {
    const ctx = buildSalesRuleLineContext({
      line: lineFor(),
      surface: "quoteLine",
      userId: "user_1",
      item: ITEM_ROW,
      customer: { id: "cust_1", customerTypeId: "ct_1" }
    });
    expect((ctx.customer as Record<string, unknown>).location).toBeUndefined();
    // Required-field semantics depend on the path resolving to undefined —
    // an empty-object location would break this.
    expect(buildResolver("customer.location.countryCode")(ctx)).toBeUndefined();
  });

  it("null location normalizes to undefined (never {})", () => {
    const ctx = buildSalesRuleLineContext({
      line: lineFor(),
      surface: "salesOrderLine",
      userId: "user_1",
      item: ITEM_ROW,
      customer: { id: "cust_1", location: null }
    });
    expect((ctx.customer as Record<string, unknown>).location).toBeUndefined();
  });

  it("no customer yields customer === undefined", () => {
    const ctx = buildSalesRuleLineContext({
      line: lineFor(),
      surface: "quoteLine",
      userId: "user_1",
      item: ITEM_ROW
    });
    expect(ctx.customer).toBeUndefined();
    expect(buildResolver("customer.customerTypeId")(ctx)).toBeUndefined();
  });
});

describe("item fallback", () => {
  it("missing item row falls back to id-only ctx so {item.id} tokens resolve", () => {
    const ctx = buildSalesRuleLineContext({
      line: { lineId: "line_1", itemId: "item_x", quantity: 1 },
      surface: "quoteLine",
      userId: "user_1",
      customer: CUSTOMER_ROW
    });
    expect(buildResolver("item.id")(ctx)).toBe("item_x");
  });

  it("line without an item builds no item ctx", () => {
    const ctx = buildSalesRuleLineContext({
      line: { lineId: "line_1", itemId: null, quantity: 1 },
      surface: "salesOrderLine",
      userId: "user_1",
      customer: CUSTOMER_ROW
    });
    expect(ctx.item).toBeUndefined();
  });
});
