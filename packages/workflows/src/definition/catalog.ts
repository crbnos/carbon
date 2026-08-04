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

export interface CatalogInput {
  type: ValueType;
  required: boolean;
  /** Allowed literal values, where the underlying column is an enum. */
  choices?: readonly string[];
  /** Prose that may interleave text and variables; the builder renders a chip editor. */
  template?: boolean;
  /** Table a non-entity foreign key points at, so the write can be scoped to the company. */
  scopeTable?: string;
  /** The column rejects null; an input resolving to nothing is skipped, not written. */
  notNull?: boolean;
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
}

/** What the validator needs to look up, and nothing more. */
export interface WorkflowCatalog {
  getEvent(id: string): CatalogEvent | undefined;
  getAction(id: string): CatalogAction | undefined;
  getOperation(id: string): CatalogOperation | undefined;
  getEntity(name: string): CatalogEntity | undefined;
  /** Allowed values for an entity's column, or undefined when it is not an enum. */
  getEnum(entity: string, property: string): readonly string[] | undefined;
}

/** The type at the end of a property path, or undefined where it does not exist. */
export function walkPath(
  type: ValueType,
  path: string[],
  catalog: WorkflowCatalog
): ValueType | undefined {
  let current = type;
  for (const segment of path) {
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
    permission: { module: "purchasing", action: "view" }
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
      }
    },
    outputs: {},
    batchable: false,
    permission: { module: "users", action: "view" },
    requireOneOf: [["user", "role"]]
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
    getOperation: (id) => operations.get(id),
    getEntity: (name) => entities.get(name),
    getEnum: options.omitEnums
      ? () => undefined
      : (entity, property) => FIXTURE_ENUMS[entity]?.[property]
  };
}
