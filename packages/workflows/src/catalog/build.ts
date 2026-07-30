import type { EventMatch } from "../definition/catalog";
import { t, type ValueType } from "../definition/types";

/** The slice of `swagger-docs-schema.ts` the builder reads. */
export interface SwaggerProperty {
  type?: string;
  format?: string;
  enum?: readonly string[];
  description?: string;
  items?: { type?: string; format?: string };
}

export interface SwaggerSchema {
  definitions: Record<
    string,
    {
      required?: readonly string[];
      properties: Record<string, SwaggerProperty | undefined>;
    }
  >;
}

export interface WatchedColumnLike {
  label: string;
  /**
   * Names the registry entity this column points at. Needed only where the
   * schema carries no foreign-key note — see `FK_TARGET`.
   */
  ref?: string;
}

export interface RegistryEntry {
  table: string;
  label: string;
  /** Lowercase permission module (an existing family — never a new one). */
  permission: string;
  /** Overrides the derived "A"/"An" where the vowel test gets it wrong. */
  article?: "A" | "An";
  /**
   * Present => triggerable (generates created/deleted/changed events).
   * Absent => reference-only: no events, but a moment or a foreign key hands it out.
   */
  watch?: Record<string, WatchedColumnLike | undefined>;
}

export interface MomentDeclarationLike {
  /** Mandatory — the generator refuses a moment without one. */
  label: string;
  permission: string;
  outputs: Record<string, ValueType>;
}

export interface BuiltEvent {
  outputs: Record<string, ValueType>;
  permission: string;
  match: EventMatch;
}

export interface BuiltCatalog {
  events: Record<string, BuiltEvent>;
  /** English label text per event id — the generator wraps these in msg``. */
  labels: Record<string, string>;
  entities: Record<string, Record<string, ValueType>>;
}

/** Columns nobody should reach: tenancy, extensibility, and audit noise. */
const DROPPED_COLUMNS = new Set([
  "companyId",
  "customFields",
  "embedding",
  "updatedAt",
  "updatedBy"
]);

/**
 * Only single-column foreign keys carry this note. A composite key like
 * `(supplierId, companyId)` has none at all, which is why the registry can
 * declare `ref` — and why a `ref` that contradicts a present note is an error.
 */
const FK_TARGET = /<fk table='([^']+)'/;

/** Lowercase only the first character, so "Purchase order" reads mid-sentence. */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * "An item", "A purchase order". The vowel test is wrong for u-words ("a user"),
 * so a registry entry can override it — a wrong article is visible to every customer.
 */
function article(label: string, override: string | undefined): string {
  return override ?? (/^[aeiou]/i.test(label) ? "An" : "A");
}

/** Table name -> registry key, so a foreign key can name a registry entity. */
function indexByTable(
  registry: Record<string, RegistryEntry>
): Map<string, string> {
  return new Map(
    Object.entries(registry).map(([name, entry]) => [entry.table, name])
  );
}

function primitiveFor(type: string | undefined): ValueType {
  if (type === "boolean") return t.boolean;
  if (type === "integer" || type === "number") return t.number;
  return t.string;
}

function propertyType(
  property: SwaggerProperty,
  entityRef: string | undefined
): ValueType {
  if (entityRef !== undefined) return t.entity(entityRef);

  if (property.type === "array") {
    const item = primitiveFor(property.items?.type);
    return t.list(item.kind === "primitive" ? item : t.string);
  }

  const format = property.format ?? "";
  if (format === "date" || format.startsWith("timestamp")) return t.date;

  return primitiveFor(property.type);
}

/** The registry entity a column resolves to, if any. */
function refFor(
  property: SwaggerProperty,
  declaredRef: string | undefined,
  byTable: Map<string, string>
): string | undefined {
  if (declaredRef !== undefined) return declaredRef;
  const fkTable = FK_TARGET.exec(property.description ?? "")?.[1];
  return fkTable === undefined ? undefined : byTable.get(fkTable);
}

/**
 * Every way the two hand-written files can disagree with the database, collected
 * rather than thrown one at a time — a migration that renames three columns
 * should report three problems, not the first one.
 */
export function validateCatalogInputs(
  registry: Record<string, RegistryEntry>,
  moments: Record<string, MomentDeclarationLike>,
  schema: SwaggerSchema
): string[] {
  const problems: string[] = [];
  const byTable = indexByTable(registry);

  for (const [name, entry] of Object.entries(registry)) {
    const definition = schema.definitions[entry.table];
    if (definition === undefined) {
      problems.push(
        `Entity "${name}" names table "${entry.table}", which is not in the database schema.`
      );
      continue;
    }

    for (const [column, watched] of Object.entries(entry.watch ?? {})) {
      if (watched === undefined) continue;

      const property = definition.properties[column];
      if (property === undefined) {
        problems.push(
          `Entity "${name}" watches column "${column}", which does not exist on table "${entry.table}". A live customer workflow on "${name}.${column}.changed" would stop firing.`
        );
        continue;
      }
      if (DROPPED_COLUMNS.has(column)) {
        problems.push(
          `Entity "${name}" watches column "${column}", which is dropped from every entity's properties — the event's field would not resolve.`
        );
      }

      if (watched.ref === undefined) continue;
      if (registry[watched.ref] === undefined) {
        problems.push(
          `Entity "${name}" declares ref "${watched.ref}" on column "${column}", which is not a registry entity.`
        );
      }
      const fkTable = FK_TARGET.exec(property.description ?? "")?.[1];
      const fkTarget = fkTable === undefined ? undefined : byTable.get(fkTable);
      if (fkTarget !== undefined && watched.ref !== fkTarget) {
        problems.push(
          `Entity "${name}" declares ref "${watched.ref}" on column "${column}", but its foreign key points at "${fkTable}".`
        );
      }
    }
  }

  for (const [key, moment] of Object.entries(moments)) {
    if (moment.label.trim().length === 0) {
      problems.push(`Moment "${key}" has no label.`);
    }
    for (const [output, type] of Object.entries(moment.outputs)) {
      if (type.kind === "entity" && registry[type.of] === undefined) {
        problems.push(
          `Moment "${key}" output "${output}" names entity "${type.of}", which is not in the registry.`
        );
      }
    }
  }

  return problems;
}

/** Every column a customer can reach by typing a dot. */
function entityProperties(
  entry: RegistryEntry,
  definition: SwaggerSchema["definitions"][string],
  byTable: Map<string, string>
): Record<string, ValueType> {
  const properties: Record<string, ValueType> = {};
  for (const [column, property] of Object.entries(definition.properties)) {
    if (property === undefined || DROPPED_COLUMNS.has(column)) continue;
    properties[column] = propertyType(
      property,
      refFor(property, entry.watch?.[column]?.ref, byTable)
    );
  }
  return properties;
}

/**
 * Turn the two hand-written inputs plus the database's own schema into one flat
 * catalog. Pure mapping — `validateCatalogInputs` owns every rejection, so the
 * generation below has no error paths to read past.
 *
 * The schema is injected rather than imported, which is what keeps
 * `@carbon/database` out of this package's runtime graph.
 */
export function buildCatalog(
  registry: Record<string, RegistryEntry>,
  moments: Record<string, MomentDeclarationLike>,
  schema: SwaggerSchema
): BuiltCatalog {
  const problems = validateCatalogInputs(registry, moments, schema);
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const byTable = indexByTable(registry);
  const events: Record<string, BuiltEvent> = {};
  const labels: Record<string, string> = {};
  const entities: Record<string, Record<string, ValueType>> = {};

  for (const [name, entry] of Object.entries(registry)) {
    const definition = schema.definitions[entry.table];
    if (definition === undefined) continue;

    entities[name] = entityProperties(entry, definition, byTable);
    if (entry.watch === undefined) continue;

    const noun = lowerFirst(entry.label);
    const determiner = article(noun, entry.article);
    const record = t.entity(name);

    events[`${name}.created`] = {
      outputs: { record },
      permission: entry.permission,
      match: { table: entry.table, operation: "INSERT" }
    };
    labels[`${name}.created`] = `${determiner} ${noun} is created`;

    events[`${name}.deleted`] = {
      outputs: { record },
      permission: entry.permission,
      match: { table: entry.table, operation: "DELETE" }
    };
    labels[`${name}.deleted`] = `${determiner} ${noun} is deleted`;

    for (const [column, watched] of Object.entries(entry.watch)) {
      if (watched === undefined) continue;
      const id = `${name}.${column}.changed`;
      events[id] = {
        outputs: { record, before: record, after: record },
        permission: entry.permission,
        match: { table: entry.table, operation: "UPDATE", field: column }
      };
      labels[id] = `${determiner} ${noun}'s ${watched.label} changes`;
    }
  }

  for (const [key, moment] of Object.entries(moments)) {
    events[key] = {
      outputs: moment.outputs,
      permission: moment.permission,
      match: { moment: key }
    };
    labels[key] = moment.label;
  }

  return { events, labels, entities };
}
