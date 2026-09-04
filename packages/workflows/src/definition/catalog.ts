import { t, type ValueType } from "./types";

/** How the matcher recognises this event. Only the matcher reads it. */
export type EventMatch =
  | { table: string; operation: "INSERT" | "UPDATE" | "DELETE"; field?: string }
  | { moment: string };

export type PermissionAction = "view" | "create" | "update" | "delete";

/** What the owner must hold for a node to run. */
export interface RequiredPermission {
  /** Lowercase permission module, e.g. "purchasing". */
  module: string;
  action: PermissionAction;
}

export interface CatalogEvent {
  id: string;
  outputs: Record<string, ValueType>;
  /** Lowercase permission module the subscribing workflow's owner must hold. */
  permission?: string;
  match?: EventMatch;
}

/**
 * Where an input's choices come from when they cannot be listed at build time.
 *
 * Deliberately generic: `provider` names a resolver the app registers, not an
 * integration. A vendor's calendar list, a Carbon-owned lookup and anything added
 * later are all the same shape here — the catalog says WHICH list, never HOW to
 * fetch it, so the builder renders every one of them with one field.
 */
export interface OptionsSource {
  /** Registered resolver id, e.g. `integration.connection`. */
  provider: string;
  /** Fixed arguments the resolver needs, decided when the catalog is built. */
  params?: Record<string, string>;
  /** Other inputs on the same node whose current values the resolver needs. The
   * field stays unfetched until every one of them holds a value. */
  dependsOn?: readonly string[];
}

export type LinkFormat = "markdown" | "slack" | "html";

/** This prose can carry a link, in the destination's own dialect — a record dropped
 * in renders as one when the engine supplies a resolver. `when` gates it on a sibling
 * input's literal value (Gmail links only an html body). Absent, a record renders as
 * its plain name and the builder says so (`notices.ts`). Webhook bodies set nothing. */
export interface LinksDeclaration {
  format: LinkFormat;
  when?: { input: string; equals: readonly string[] };
}

export interface CatalogInput {
  type: ValueType;
  required: boolean;
  /** Allowed literal values, where the underlying column is an enum. */
  choices?: readonly string[];
  /** What the builder seeds a new node with. Must be drawn from `choices` when both are
   * set. Stored like any other value — nothing reads it at run time. */
  defaultValue?: string | number | boolean | readonly string[];
  /** The vendor's own explanation of the field, for the builder's ⓘ hover. */
  description?: string;
  /** Prose that may interleave text and variables; the builder renders a chip editor. */
  template?: boolean;
  /** The input is a moment, not a calendar day: the builder renders a date AND
   * time picker and stores a full ISO instant. Set from a vendor's `DATE_TIME`
   * property. Never set on a Carbon business date (`dueDate`, `orderDate`,
   * `postingDate`), which is a day on the company's calendar and has no time. */
  precision?: "datetime";
  links?: LinksDeclaration;
  /** Table a non-entity foreign key points at, so the write can be scoped to the company. */
  scopeTable?: string;
  /** The column rejects null; an input resolving to nothing is skipped, not written. */
  notNull?: boolean;
  /** The value is a set of name/value rows; the builder renders an editable list.
   * Only a `pairs` value is legal here, and a `pairs` value is legal nowhere else. */
  pairs?: boolean;
  /** Choices are fetched while editing rather than listed in `choices`. */
  options?: OptionsSource;
  /** Show — and only then require — this input while another input holds one of these
   * values. Evaluated on literals only: a variable-valued gate cannot be read at build
   * time, so it opens rather than guessing and hiding the user's work. */
  showWhen?: { input: string; equals: readonly string[] };
}

/**
 * Whether an input holds a SET of its `choices` rather than one of them — the builder
 * renders a multi-select and stores a list literal. Derived rather than declared: a fixed
 * set of values on a list of text has no other reading, and a hand-set flag could only
 * ever disagree with the type it describes.
 */
export function isMultiSelect<
  T extends { type: ValueType; choices?: readonly string[] }
>(input: T): input is T & { choices: readonly string[] } {
  return (
    input.choices !== undefined &&
    input.type.kind === "list" &&
    input.type.of.kind === "primitive" &&
    input.type.of.of === "string"
  );
}

export interface CatalogAction {
  id: string;
  inputs: Record<string, CatalogInput>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
  permission: RequiredPermission;
  /** Each group needs at least one of its input names supplied. */
  requireOneOf?: string[][];
}

/** The input every integration step carries: which of the company's connections it acts
 * as. Named here because the builder has to ask "is this app connected at all?" before it
 * can offer any of its steps. */
export const INTEGRATION_CONNECTION_INPUT = "connectionId";

/** The catalog id for one integration step. The ONE place the shape is written:
 * routing reads the catalog entry, never the id. */
export function integrationStepId(piece: string, action: string): string {
  return `integration.${piece}.${action}`;
}

/** The label key holding an app's own display name — "Google Calendar", not the
 * `google-calendar` package slug. Carried through the generator rather than derived
 * from the slug, so a vendor that does not title-case ("HubSpot", "GitHub") reads
 * correctly and is translated like every other catalog string. */
export function integrationAppLabelKey(piece: string): string {
  return `integration.${piece}`;
}

/**
 * One step a third-party integration offers. Separate from `CatalogAction` on
 * purpose: an action is something Carbon does to its own data, and nothing on the
 * action path should have to ask whether it is really a vendor call.
 */
export interface CatalogIntegration {
  id: string;
  inputs: Record<string, CatalogInput>;
  /** Inputs hidden from the ordinary form and shown only under Advanced. Separate
   * from `inputs` so nothing validating required fields can demand one. */
  advancedInputs?: Record<string, CatalogInput>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
  permission: RequiredPermission;
  piece: { name: string; action: string };
}

export interface CatalogOperation {
  id: string;
  entity: string;
  inputs: Record<string, CatalogInput>;
  output: ValueType;
  permission: RequiredPermission;
}

export interface CatalogEntity {
  name: string;
  properties: Record<string, ValueType>;
  /** What the owner must hold to read one; a lookup gates on this. */
  permission?: RequiredPermission;
  /** Plain-English per-column description, keyed by column name.
   * Only present for columns the registry explicitly describes. */
  descriptions?: Record<string, string>;
  /** Columns that spell this record's name, best first — how it reads in prose. */
  display?: readonly string[];
}

/** What the validator needs to look up, and nothing more. */
export interface WorkflowCatalog {
  getEvent(id: string): CatalogEvent | undefined;
  getAction(id: string): CatalogAction | undefined;
  getIntegration(id: string): CatalogIntegration | undefined;
  getOperation(id: string): CatalogOperation | undefined;
  getEntity(name: string): CatalogEntity | undefined;
  /** Allowed values for an entity's column, or undefined when it is not an enum. */
  getEnum(entity: string, property: string): readonly string[] | undefined;
  /** The customer's own name for a property, when it is a custom field. */
  getPropertyLabel(entity: string, property: string): string | undefined;
  /** The customer's own name for an action input, when it is a custom field. */
  getInputLabel(actionId: string, input: string): string | undefined;
}

/** The type at the end of a property path, or undefined where it does not exist. */
export function walkPath(
  type: ValueType,
  path: string[],
  catalog: WorkflowCatalog
): ValueType | undefined {
  let current = type;
  for (const segment of path) {
    // A record carries its own fields, so it needs no catalog lookup.
    if (current.kind === "record") {
      const next = current.fields[segment];
      if (next === undefined) return undefined;
      current = next;
      continue;
    }
    if (current.kind !== "entity") return undefined;
    const entity = catalog.getEntity(current.of);
    if (entity === undefined) return undefined;
    const next = entity.properties[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

const FIXTURE_EVENTS: CatalogEvent[] = [
  {
    id: "purchaseOrder.status.changed",
    outputs: {
      purchaseOrder: t.entity("purchaseOrder"),
      before: t.entity("purchaseOrder")
    }
  },
  { id: "part.created", outputs: { part: t.entity("part") } }
];

const FIXTURE_ENTITIES: CatalogEntity[] = [
  {
    name: "purchaseOrder",
    properties: {
      amount: t.number,
      status: t.string,
      assignee: t.entity("user")
    },
    permission: { module: "purchasing", action: "view" },
    display: ["purchaseOrderId"]
  },
  {
    name: "user",
    properties: { email: t.string, manager: t.entity("user") },
    permission: { module: "users", action: "view" }
  },
  {
    name: "part",
    properties: { name: t.string, unitPrice: t.number },
    permission: { module: "parts", action: "view" }
  },
  {
    name: "job",
    properties: { name: t.string, dueDate: t.date },
    permission: { module: "production", action: "view" }
  },
  {
    name: "issue",
    properties: { title: t.string },
    permission: { module: "quality", action: "view" }
  }
];

const FIXTURE_ACTIONS: CatalogAction[] = [
  {
    id: "notify",
    inputs: {
      recipient: { type: t.entity("user"), required: true },
      message: { type: t.string, required: true }
    },
    outputs: {},
    batchable: true,
    permission: { module: "users", action: "view" }
  },
  {
    id: "updatePart",
    inputs: {
      part: { type: t.entity("part"), required: true },
      name: { type: t.string, required: false }
    },
    outputs: { part: t.entity("part") },
    batchable: true,
    permission: { module: "parts", action: "update" }
  },
  {
    // Two entity inputs, so a list can be wired to each — the shape that makes
    // "which one does this step repeat over?" unanswerable.
    id: "assignPart",
    inputs: {
      part: { type: t.entity("part"), required: true },
      user: { type: t.entity("user"), required: true }
    },
    outputs: { part: t.entity("part") },
    batchable: true,
    permission: { module: "parts", action: "update" }
  },
  {
    id: "createIssue",
    inputs: { title: { type: t.string, required: true } },
    outputs: { issue: t.entity("issue") },
    batchable: false,
    permission: { module: "quality", action: "create" }
  },
  {
    id: "alertSomeone",
    inputs: {
      user: { type: t.entity("user"), required: false },
      role: {
        type: t.string,
        required: false,
        choices: ["Buyer", "Manager", "Admin"]
      },
      channels: {
        type: t.list({ kind: "primitive", of: "string" }),
        required: false,
        choices: ["inApp", "email", "slack"],
        defaultValue: ["inApp"]
      }
    },
    outputs: {},
    batchable: false,
    permission: { module: "users", action: "view" },
    requireOneOf: [["user", "role"]]
  },
  {
    // The shape the webhook action uses: named rows, plus an input gated on a dropdown.
    id: "callUrl",
    inputs: {
      url: { type: t.string, required: true },
      method: {
        type: t.string,
        required: false,
        choices: ["GET", "POST"]
      },
      headers: { type: t.string, required: false, pairs: true },
      body: {
        type: t.string,
        required: true,
        template: true,
        showWhen: { input: "method", equals: ["POST"] }
      }
    },
    outputs: { status: t.number },
    batchable: true,
    permission: { module: "workflows", action: "update" }
  }
];

const FIXTURE_OPERATIONS: CatalogOperation[] = [
  {
    id: "job.totalScrap",
    entity: "job",
    inputs: { job: { type: t.entity("job"), required: true } },
    output: t.number,
    permission: { module: "production", action: "view" }
  }
];

const FIXTURE_ENUMS: Record<string, Record<string, readonly string[]>> = {
  purchaseOrder: { status: ["Draft", "Planned", "To Receive"] }
};

export interface FixtureCatalogOptions {
  omitEvents?: string[];
  omitActions?: string[];
  omitOperations?: string[];
  omitEntities?: string[];
  omitEnums?: boolean;
}

/** An in-memory catalog for tests; `omit*` drops entries to simulate a stale catalog. */
export function createFixtureCatalog(
  options: FixtureCatalogOptions = {}
): WorkflowCatalog {
  const index = <T>(items: T[], key: (item: T) => string, omit?: string[]) => {
    const omitted = new Set(omit ?? []);
    return new Map(
      items.filter((item) => !omitted.has(key(item))).map((i) => [key(i), i])
    );
  };

  const events = index(FIXTURE_EVENTS, (e) => e.id, options.omitEvents);
  const actions = index(FIXTURE_ACTIONS, (a) => a.id, options.omitActions);
  const operations = index(
    FIXTURE_OPERATIONS,
    (o) => o.id,
    options.omitOperations
  );
  const entities = index(FIXTURE_ENTITIES, (e) => e.name, options.omitEntities);

  return {
    getEvent: (id) => events.get(id),
    getAction: (id) => actions.get(id),
    // The fixtures carry no integration steps: they exercise the definition model,
    // and a vendor's form adds nothing to that.
    getIntegration: () => undefined,
    getOperation: (id) => operations.get(id),
    getEntity: (name) => entities.get(name),
    getEnum: options.omitEnums
      ? () => undefined
      : (entity, property) => FIXTURE_ENUMS[entity]?.[property],
    // The fixtures carry no custom fields, so nothing here has a customer-given name.
    getPropertyLabel: () => undefined,
    getInputLabel: () => undefined
  };
}
