/**
 * The docs glossary — one source of truth for the inline <Term> popovers.
 *
 * Keys are slugs (lowercase, hyphenated). Author usage in MDX:
 *   <Term>purchase to order</Term>          — slugifies the text to find the entry
 *   <Term id="purchase-to-order">bought</Term> — explicit key when display text differs
 *
 * Every definition is grounded in real Carbon source/migrations, not ERP-generic
 * prose. `href` (optional) points the "Learn more" link at the page that tells the
 * fuller story; omit it for terms with no dedicated page yet (popover still shows the
 * definition). Enum values verified:
 *   methodType            → "Make to Order" | "Purchase to Order" | "Pull from Inventory"
 *                           (packages/database/.../20260321143847_method-type-migration.sql)
 *   itemReplenishmentSystem → "Buy" | "Make" | "Buy and Make"
 *                           (packages/database/.../20230330024716_parts.sql)
 */
export type GlossaryEntry = {
  /** Canonical name shown as the popover heading. */
  term: string;
  /** One or two grounded sentences. */
  definition: string;
  /** Optional internal route for the "Learn more" link. */
  href?: string;
};

export const glossary: Record<string, GlossaryEntry> = {
  "method-type": {
    term: "Method type",
    definition:
      "How a part gets into its parent — set per line on a method. One of Make to Order, Purchase to Order, or Pull from Inventory. Separate from the item's replenishment system.",
    href: "/docs/reference/methods",
  },
  "make-to-order": {
    term: "Make to Order",
    definition:
      "The part is manufactured as its own job, with its own routing, when the parent that needs it is built.",
    href: "/docs/reference/methods",
  },
  "purchase-to-order": {
    term: "Purchase to Order",
    definition:
      "The material for that specific customer order is purchased from a supplier instead of being made or pulled from inventory.",
    href: "/docs/reference/methods",
  },
  "pull-from-inventory": {
    term: "Pull from Inventory",
    definition:
      "The part is taken from existing stock when its parent is built — no new job or purchase order is created for it.",
    href: "/docs/reference/methods",
  },
  "replenishment-system": {
    term: "Replenishment system",
    definition:
      "How an item is replenished overall, and which planning queue its shortfalls land in: Buy, Make, or Buy and Make. Set per item — unlike the per-line method type.",
    href: "/docs/reference/items",
  },
  method: {
    term: "Method",
    definition:
      "Carbon's name for a bill of materials: the materials (the components) plus the operations (the routing) that make a part.",
    href: "/docs/reference/methods",
  },
  bom: {
    term: "Bill of materials",
    definition:
      "In Carbon a bill of materials is called a method — the components plus the operations that produce a part.",
    href: "/docs/reference/methods",
  },
  wip: {
    term: "Work in process (WIP)",
    definition:
      "Not a table — a general-ledger balance. Costs accumulate in the WIP account as job materials are issued, and clear out when the job is received to stock.",
  },
  "outside-operation": {
    term: "Outside operation",
    definition:
      "An operation performed by an outside supplier rather than an in-house work center. Carbon raises a subcontracting purchase order to cover it.",
  },
  subassembly: {
    term: "Subassembly",
    definition:
      "A Make to Order component that gets its own job and routing inside the parent's build.",
    href: "/docs/reference/methods",
  },
  kit: {
    term: "Kit",
    definition:
      "A Make to Order component whose parts are issued together into the parent job — no separate build of its own.",
    href: "/docs/reference/methods",
  },
  "lead-time": {
    term: "Lead time",
    definition:
      "Days from ordering a part to having it available. Planning offsets demand backward by this much so supply arrives in time.",
    href: "/docs/reference/reordering",
  },
  "reorder-point": {
    term: "Reorder point",
    definition:
      "The on-hand level that triggers a new replenishment order under the Fixed Reorder Quantity and Maximum Quantity policies.",
    href: "/docs/reference/reordering",
  },
  "reordering-policy": {
    term: "Reordering policy",
    definition:
      "How an item is replenished: Manual Reorder, Demand-Based Reorder, Fixed Reorder Quantity, or Maximum Quantity.",
    href: "/docs/reference/reordering",
  },
};
