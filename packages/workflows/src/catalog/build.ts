import type { EventMatch, RequiredPermission } from "../definition/catalog";
import { t, type ValueType } from "../definition/types";
import type { ActionDeclarationLike } from "./actions";
import type { OperationDeclarationLike } from "./operations";

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
  /** Registry entity this column points at; needed only when the schema has no fk note. */
  ref?: string;
}

export interface WritableColumnLike {
  label: string;
  /** Registry entity this column points at; needed only when the schema has no fk note. */
  ref?: string;
}

export interface RegistryEntry {
  table: string;
  label: string;
  /** Lowercase permission module; must be an existing family. */
  permission: string;
  /** Overrides the derived "A"/"An" where the vowel test gets it wrong. */
  article?: "A" | "An";
  /** Present => triggerable; absent => reference-only, no events generated. */
  watch?: Record<string, WatchedColumnLike | undefined>;
  /** Inert columns a workflow may set. Unrelated to `watch`; the default is excluded. */
  write?: Record<string, WritableColumnLike | undefined>;
}

export interface MomentDeclarationLike {
  label: string;
  permission: string;
  outputs: Record<string, ValueType>;
}

export interface BuiltEvent {
  outputs: Record<string, ValueType>;
  permission: string;
  match: EventMatch;
}

export interface BuiltActionInput {
  type: ValueType;
  required: boolean;
  choices?: readonly string[];
  template?: boolean;
}

export interface BuiltAction {
  inputs: Record<string, BuiltActionInput>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
  permission: RequiredPermission;
  requireOneOf?: string[][];
  call?: string;
  update?: { entity: string };
}

export interface BuiltOperation {
  entity: string;
  inputs: Record<string, BuiltActionInput>;
  output: ValueType;
  permission: RequiredPermission;
}

export interface BuiltCatalog {
  events: Record<string, BuiltEvent>;
  /** English label text per event, action and operation id; the generator wraps these in msg``. */
  labels: Record<string, string>;
  entities: Record<string, Record<string, ValueType>>;
  /** Allowed values per entity + property, only for enum columns. */
  enums: Record<string, Record<string, readonly string[]>>;
  actions: Record<string, BuiltAction>;
  operations: Record<string, BuiltOperation>;
}

/** A hand-written action with neither of these has no way to run. */
const BUILT_IN_ACTIONS = new Set(["notify", "webhook"]);

/** Tenancy, extensibility and audit columns, hidden from every entity. */
const DROPPED_COLUMNS = new Set([
  "companyId",
  "customFields",
  "embedding",
  "updatedAt",
  "updatedBy"
]);

/** Identity and audit columns a workflow may never set. */
const UNWRITABLE_COLUMNS = new Set([
  "id",
  "companyId",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt"
]);

/** Only single-column foreign keys carry this note; composite keys have none. */
const FK_TARGET = /<fk table='([^']+)'/;

/** Lowercase only the first character, so "Purchase order" reads mid-sentence. */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** `nonConformanceTypeId` -> `Non conformance type`. */
function humanizeColumn(column: string): string {
  const withoutId = column.replace(/Id$/, "");
  const spaced = withoutId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The vowel test is wrong for u-words ("a user"), so an entry can override it. */
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

/** Collects every problem rather than throwing on the first. */
export function validateCatalogInputs(
  registry: Record<string, RegistryEntry>,
  moments: Record<string, MomentDeclarationLike>,
  actions: Record<string, ActionDeclarationLike>,
  operations: Record<string, OperationDeclarationLike>,
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

    for (const [column, writable] of Object.entries(entry.write ?? {})) {
      if (writable === undefined) continue;

      const property = definition.properties[column];
      if (property === undefined) {
        problems.push(
          `Entity "${name}" declares writable column "${column}", which does not exist on table "${entry.table}".`
        );
        continue;
      }
      if (DROPPED_COLUMNS.has(column) || UNWRITABLE_COLUMNS.has(column)) {
        problems.push(
          `Entity "${name}" declares writable column "${column}", which a workflow may never set.`
        );
      }

      if (writable.ref === undefined) continue;
      if (registry[writable.ref] === undefined) {
        problems.push(
          `Entity "${name}" declares ref "${writable.ref}" on writable column "${column}", which is not a registry entity.`
        );
      }
      const writeFkTable = FK_TARGET.exec(property.description ?? "")?.[1];
      const writeFkTarget =
        writeFkTable === undefined ? undefined : byTable.get(writeFkTable);
      if (writeFkTarget !== undefined && writable.ref !== writeFkTarget) {
        problems.push(
          `Entity "${name}" declares ref "${writable.ref}" on writable column "${column}", but its foreign key points at "${writeFkTable}".`
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

  const checkEntityType = (
    what: string,
    where: string,
    type: ValueType
  ): void => {
    const named =
      type.kind === "entity"
        ? type.of
        : type.kind === "list" && type.of.kind === "entity"
          ? type.of.of
          : undefined;
    if (named !== undefined && registry[named] === undefined) {
      problems.push(
        `${what} ${where} names entity "${named}", which is not in the registry.`
      );
    }
  };

  for (const [id, declaration] of Object.entries(actions)) {
    if (declaration.label.trim().length === 0) {
      problems.push(`Action "${id}" has no label.`);
    }
    if (declaration.call === undefined && !BUILT_IN_ACTIONS.has(id)) {
      problems.push(`Action "${id}" has no implementation route.`);
    }
    for (const [input, spec] of Object.entries(declaration.inputs)) {
      checkEntityType(`Action "${id}"`, `input "${input}"`, spec.type);
      if (
        spec.template === true &&
        !(spec.type.kind === "primitive" && spec.type.of === "string")
      ) {
        problems.push(`${id}.${input} is a template but is not a string.`);
      }
    }
    for (const [output, type] of Object.entries(declaration.outputs)) {
      checkEntityType(`Action "${id}"`, `output "${output}"`, type);
    }
  }

  for (const [id, declaration] of Object.entries(operations)) {
    if (declaration.label.trim().length === 0) {
      problems.push(`Operation "${id}" has no label.`);
    }
    if (registry[declaration.entity] === undefined) {
      problems.push(
        `Operation "${id}" names entity "${declaration.entity}", which is not in the registry.`
      );
    }
    for (const [input, spec] of Object.entries(declaration.inputs)) {
      checkEntityType(`Operation "${id}"`, `input "${input}"`, spec.type);
    }
    checkEntityType(`Operation "${id}"`, "output", declaration.output);
  }

  return problems;
}

/** The enum a column declares, or undefined. `SwaggerProperty.enum` already exists. */
function enumFor(
  schema: SwaggerSchema,
  table: string,
  column: string
): readonly string[] | undefined {
  return schema.definitions[table]?.properties?.[column]?.enum;
}

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

/** The schema is injected, not imported, to keep `@carbon/database` out of the runtime graph. */
export function buildCatalog(
  registry: Record<string, RegistryEntry>,
  moments: Record<string, MomentDeclarationLike>,
  handWrittenActions: Record<string, ActionDeclarationLike>,
  handWrittenOperations: Record<string, OperationDeclarationLike>,
  schema: SwaggerSchema
): BuiltCatalog {
  const problems = validateCatalogInputs(
    registry,
    moments,
    handWrittenActions,
    handWrittenOperations,
    schema
  );
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const byTable = indexByTable(registry);
  const events: Record<string, BuiltEvent> = {};
  const labels: Record<string, string> = {};
  const entities: Record<string, Record<string, ValueType>> = {};
  const enums: Record<string, Record<string, readonly string[]>> = {};
  const actions: Record<string, BuiltAction> = {};
  const operations: Record<string, BuiltOperation> = {};

  for (const [name, entry] of Object.entries(registry)) {
    const definition = schema.definitions[entry.table];
    if (definition === undefined) continue;

    entities[name] = entityProperties(entry, definition, byTable);

    // Collect enum values for any column that declares them.
    const entityEnumMap: Record<string, readonly string[]> = {};
    for (const [column, property] of Object.entries(definition.properties)) {
      if (
        property?.enum &&
        property.enum.length > 0 &&
        !DROPPED_COLUMNS.has(column)
      ) {
        entityEnumMap[column] = property.enum;
      }
    }
    if (Object.keys(entityEnumMap).length > 0) enums[name] = entityEnumMap;

    // entity.<name> label
    labels[`entity.${name}`] = entry.label;

    // entity.<name>.<column> labels for all non-dropped properties
    for (const [column] of Object.entries(definition.properties)) {
      if (DROPPED_COLUMNS.has(column)) continue;
      const watchedLabel = entry.watch?.[column]?.label;
      const writableLabel = entry.write?.[column]?.label;
      const rawLabel = watchedLabel ?? writableLabel;
      const label =
        rawLabel !== undefined
          ? rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)
          : humanizeColumn(column);
      if (label.includes("`") || label.includes("${")) {
        throw new Error(
          `Label for entity.${name}.${column} contains a backtick or template literal: "${label}"`
        );
      }
      labels[`entity.${name}.${column}`] = label;
    }

    const writable = Object.entries(entry.write ?? {}).filter(
      ([, column]) => column !== undefined
    );
    if (writable.length > 0) {
      const id = `${name}.update`;
      // The input keyed by the entity name is the record; the rest are the fields.
      const inputs: Record<string, BuiltActionInput> = {
        [name]: { type: t.entity(name), required: true }
      };
      for (const [column, spec] of writable) {
        const property = definition.properties[column];
        if (property === undefined) continue;
        inputs[column] = {
          type: propertyType(property, refFor(property, spec?.ref, byTable)),
          required: false
        };
        const enumValues = enumFor(schema, entry.table, column);
        if (enumValues !== undefined && enumValues.length > 0) {
          inputs[column].choices = enumValues;
        }
      }
      actions[id] = {
        inputs,
        outputs: { record: t.entity(name) },
        batchable: true,
        permission: { module: entry.permission, action: "update" },
        update: { entity: name }
      };
      labels[id] =
        `Update ${article(lowerFirst(entry.label), entry.article).toLowerCase()} ${lowerFirst(entry.label)}`;
    }

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

  for (const [id, declaration] of Object.entries(handWrittenActions)) {
    if (actions[id] !== undefined) {
      throw new Error(
        `Action "${id}" is declared by hand and also generated from the entity registry.`
      );
    }
    const inputs: Record<string, BuiltActionInput> = {};
    for (const [input, spec] of Object.entries(declaration.inputs)) {
      inputs[input] = {
        type: spec.type,
        required: spec.required,
        ...(spec.template ? { template: true } : {})
      };
      const [entityPrefix] = id.split(".");
      const table =
        entityPrefix !== undefined ? registry[entityPrefix]?.table : undefined;
      if (table !== undefined) {
        const values = enumFor(schema, table, input);
        if (values !== undefined && values.length > 0) {
          inputs[input].choices = values;
        }
      }
    }
    actions[id] = {
      inputs,
      outputs: declaration.outputs,
      batchable: declaration.batchable,
      permission: declaration.permission,
      ...(declaration.requireOneOf === undefined
        ? {}
        : { requireOneOf: declaration.requireOneOf }),
      ...(declaration.call === undefined ? {} : { call: declaration.call })
    };
    labels[id] = declaration.label;
    for (const [input, spec] of Object.entries(declaration.inputs)) {
      const rawLabel = spec.label;
      const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
      if (label.includes("`") || label.includes("${")) {
        throw new Error(
          `Label for action.${id}.input.${input} contains a backtick or template literal: "${label}"`
        );
      }
      labels[`action.${id}.input.${input}`] = label;
    }
  }

  for (const [id, declaration] of Object.entries(handWrittenOperations)) {
    const inputs: Record<string, BuiltActionInput> = {};
    for (const [input, spec] of Object.entries(declaration.inputs)) {
      inputs[input] = { type: spec.type, required: spec.required };
    }
    operations[id] = {
      entity: declaration.entity,
      inputs,
      output: declaration.output,
      permission: declaration.permission
    };
    labels[id] = declaration.label;
    for (const [input, spec] of Object.entries(declaration.inputs)) {
      const rawLabel = spec.label;
      const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
      labels[`operation.${id}.input.${input}`] = label;
    }
  }

  return { events, labels, entities, enums, actions, operations };
}
