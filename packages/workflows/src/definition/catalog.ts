import { t, type ValueType } from "./types";

/** How the matcher recognises this event. Only the matcher reads it. */
export type EventMatch =
  | { table: string; operation: "INSERT" | "UPDATE" | "DELETE"; field?: string }
  | { moment: string };

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
}

export interface CatalogAction {
  id: string;
  inputs: Record<string, CatalogInput>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
}

export interface CatalogOperation {
  id: string;
  entity: string;
  inputs: Record<string, CatalogInput>;
  output: ValueType;
}

export interface CatalogEntity {
  name: string;
  properties: Record<string, ValueType>;
}

/** What the validator needs to look up, and nothing more. */
export interface WorkflowCatalog {
  getEvent(id: string): CatalogEvent | undefined;
  getAction(id: string): CatalogAction | undefined;
  getOperation(id: string): CatalogOperation | undefined;
  getEntity(name: string): CatalogEntity | undefined;
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
    }
  },
  { name: "user", properties: { email: t.string, manager: t.entity("user") } },
  { name: "part", properties: { name: t.string, unitPrice: t.number } },
  { name: "job", properties: { name: t.string, dueDate: t.date } },
  { name: "issue", properties: { title: t.string } }
];

const FIXTURE_ACTIONS: CatalogAction[] = [
  {
    id: "notify",
    inputs: {
      recipient: { type: t.entity("user"), required: true },
      message: { type: t.string, required: true }
    },
    outputs: {},
    batchable: true
  },
  {
    id: "updatePart",
    inputs: {
      part: { type: t.entity("part"), required: true },
      name: { type: t.string, required: false }
    },
    outputs: { part: t.entity("part") },
    batchable: true
  },
  {
    id: "createIssue",
    inputs: { title: { type: t.string, required: true } },
    outputs: { issue: t.entity("issue") },
    batchable: false
  }
];

const FIXTURE_OPERATIONS: CatalogOperation[] = [
  {
    id: "job.totalScrap",
    entity: "job",
    inputs: { job: { type: t.entity("job"), required: true } },
    output: t.number
  }
];

export interface FixtureCatalogOptions {
  omitEvents?: string[];
  omitActions?: string[];
  omitOperations?: string[];
  omitEntities?: string[];
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
    getEntity: (name) => entities.get(name)
  };
}
