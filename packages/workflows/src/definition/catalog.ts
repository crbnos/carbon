import type { ValueType } from "./types";

export interface CatalogEvent {
  id: string;
  outputs: Record<string, ValueType>;
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

/**
 * What the validator needs to look up, and nothing more. Phases 2 and 5 satisfy
 * this from the generated event catalog and the hand-curated action catalog.
 */
export interface WorkflowCatalog {
  getEvent(id: string): CatalogEvent | undefined;
  getAction(id: string): CatalogAction | undefined;
  getOperation(id: string): CatalogOperation | undefined;
  getEntity(name: string): CatalogEntity | undefined;
}

const num: ValueType = { kind: "primitive", of: "number" };
const str: ValueType = { kind: "primitive", of: "string" };
const entity = (of: string): ValueType => ({ kind: "entity", of });

const FIXTURE_EVENTS: CatalogEvent[] = [
  {
    id: "purchaseOrder.status.changed",
    outputs: {
      purchaseOrder: entity("purchaseOrder"),
      before: entity("purchaseOrder")
    }
  },
  { id: "part.created", outputs: { part: entity("part") } }
];

const FIXTURE_ENTITIES: CatalogEntity[] = [
  {
    name: "purchaseOrder",
    properties: {
      amount: num,
      status: str,
      assignee: entity("user")
    }
  },
  { name: "user", properties: { email: str, manager: entity("user") } },
  { name: "part", properties: { name: str, unitPrice: num } },
  { name: "job", properties: { name: str } },
  { name: "issue", properties: { title: str } }
];

const FIXTURE_ACTIONS: CatalogAction[] = [
  {
    id: "notify",
    inputs: {
      recipient: { type: entity("user"), required: true },
      message: { type: str, required: true }
    },
    outputs: {},
    batchable: true
  },
  {
    id: "updatePart",
    inputs: {
      part: { type: entity("part"), required: true },
      name: { type: str, required: false }
    },
    outputs: { part: entity("part") },
    batchable: true
  },
  {
    id: "createIssue",
    inputs: { title: { type: str, required: true } },
    outputs: { issue: entity("issue") },
    batchable: false
  }
];

const FIXTURE_OPERATIONS: CatalogOperation[] = [
  {
    id: "job.totalScrap",
    entity: "job",
    inputs: { job: { type: entity("job"), required: true } },
    output: num
  }
];

export interface FixtureCatalogOptions {
  omitEvents?: string[];
  omitActions?: string[];
  omitOperations?: string[];
  omitEntities?: string[];
}

/**
 * An in-memory catalog for tests, so the validator can be written and fully
 * exercised before the real event and action catalogs land in phases 2 and 5.
 * The `omit*` options prove the catalog is genuinely injected, not baked in.
 */
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
