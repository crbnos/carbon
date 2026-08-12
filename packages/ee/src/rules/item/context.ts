// Pure RuleContext assembly for item-rules evaluation (sales-document
// surfaces). Deliberately side-effect-free (no auth/env/DB imports) so the
// registry↔code-path contract can be unit-tested without booting the server
// environment. `server.ts` owns the DB I/O and calls `buildItemRuleLineContext`
// with the rows it loaded. Mirrors `../storage/context.ts`.

import type { ItemRuleSurface, RuleContext } from "@carbon/utils";

export type ItemRuleLineInput = {
  /** Diagnostic identifier — not used in eval. */
  lineId: string;
  /** Item the sales-document line references. */
  itemId?: string | null;
  /** Quantity for `transaction.quantity` predicates. */
  quantity: number;
};

export type ItemRuleItemCtxRow = Record<string, unknown> & {
  customFields?: Record<string, unknown>;
};

/**
 * Customer context input assembled by `server.ts` from the `customer` row and
 * the resolved ship-to country. `location` MUST stay undefined (never `{}`)
 * when no country is resolvable so `customer.location.countryCode` resolves
 * undefined and required-field semantics fire for rules referencing it.
 */
export type CustomerCtxInput = {
  id: string;
  customerTypeId?: string | null;
  customerStatusId?: string | null;
  customFields?: Record<string, unknown>;
  location?: { countryCode?: string | null } | null;
};

/**
 * Assemble the `RuleContext` for a single sales-document line. Pure — so the
 * registry↔code-path contract (which root contexts get populated per surface)
 * can be unit-tested without a DB client. See the anti-drift test in
 * `context.test.ts` and `ITEM_RULE_SURFACE_CONTEXT_AVAILABILITY` in
 * `@carbon/utils`.
 *
 * `item` is the row loaded from the DB (or undefined when the lookup missed);
 * the id-only fallback keeps token interpolation working when a join didn't
 * materialize (RLS, late insert).
 */
export const buildItemRuleLineContext = (args: {
  line: ItemRuleLineInput;
  surface: ItemRuleSurface;
  userId: string;
  item?: ItemRuleItemCtxRow;
  customer?: CustomerCtxInput;
}): RuleContext => {
  const { line, surface, userId } = args;
  return {
    item: line.itemId ? (args.item ?? { id: line.itemId }) : undefined,
    customer: args.customer
      ? {
          id: args.customer.id,
          customerTypeId: args.customer.customerTypeId,
          customerStatusId: args.customer.customerStatusId,
          customFields: args.customer.customFields,
          // `?? undefined` normalizes null → undefined; NEVER default to `{}`
          // (an empty object would defeat required-field semantics for
          // `customer.location.countryCode`).
          location: args.customer.location ?? undefined
        }
      : undefined,
    transaction: {
      kind: surface,
      quantity: line.quantity,
      userId
    }
  };
};
