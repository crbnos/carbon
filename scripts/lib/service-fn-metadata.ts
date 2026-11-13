// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Manifest entries for the service functions (`defineServiceFn`) that the ERP
 * router publishes. The router (`apps/erp/app/modules/router.server.ts`) is the
 * source: a leaf is published when its TSDoc carries `@mcp`. The summary line
 * is the title, `@remarks` the description, `@mcp destructive` the
 * classification override. Input and response schemas come from the leaf's
 * TYPE, through the same reflection the legacy tools use.
 */

import * as path from "path";
import type {
  Classification,
  ManifestEntry,
  PermissionAction,
  ToolPermission
} from "@carbon/api";
import { readGate } from "../../packages/api/src/permissions";
import {
  ACTIONS,
  type AnyGate,
  type Level,
  LEVELS,
  levelHolds,
  moduleOf,
  PAGES,
  type PageGate,
  pageById
} from "../../packages/database/src/access";
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type Symbol as TsSymbol,
  type Type,
  type VariableDeclaration
} from "ts-morph";
import {
  type JsonSchema,
  typeToJsonSchema,
  unwrapResponseType
} from "./response-schema";
import { appliesGenericFilters, inputFieldDescriptions } from "./input-docs";

const ROUTER_FILE = path.resolve(
  __dirname,
  "../../apps/erp/app/modules/router.server.ts"
);

const GATE_LEVELS: readonly string[] = LEVELS.filter(
  (level) => level !== "None"
);

/** A property's name as written: `"inventory.receipts"` or `documents`. */
function literalName(entry: Node): string | undefined {
  if (!Node.isPropertyAssignment(entry)) return undefined;
  const name = entry.getNameNode();
  if (Node.isStringLiteral(name)) return name.getLiteralValue();
  if (Node.isIdentifier(name)) return name.getText();
  return undefined;
}

/** `GenericQueryFilters.filters` (`apps/erp/app/utils/query.ts`). */
const GENERIC_FILTERS_SCHEMA: JsonSchema = {
  type: "array",
  description:
    "Narrows the list: each filter compares one returned field. `in` and `contains` take a comma-separated list, `between` takes `from,to`.",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      operator: {
        type: "string",
        enum: [
          "between",
          "contains",
          "eq",
          "gt",
          "gte",
          "in",
          "lt",
          "lte",
          "neq",
          "startsWith"
        ]
      },
      value: { type: "string" }
    },
    required: ["column", "operator", "value"]
  }
};

/** `GenericQueryFilters.sorts`. */
const GENERIC_SORTS_SCHEMA: JsonSchema = {
  type: "array",
  description: "Orders the list by returned fields, first to last.",
  items: {
    type: "object",
    properties: {
      sortBy: { type: "string" },
      sortAsc: { type: "boolean" }
    },
    required: ["sortBy", "sortAsc"]
  }
};

export interface ServiceFnLeaf {
  path: string[];
  declaration: VariableDeclaration;
  call: CallExpression;
}

function variableOf(symbol: TsSymbol | undefined): VariableDeclaration | null {
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations().find(Node.isVariableDeclaration) ?? null;
}

function defineCall(declaration: VariableDeclaration): CallExpression | null {
  const init = declaration.getInitializer();
  return init &&
    Node.isCallExpression(init) &&
    init.getExpression().getText() === "defineServiceFn"
    ? init
    : null;
}

/** Every `defineServiceFn` leaf of the router, with its path. */
export function routerLeaves(
  project: Project,
  routerFile = ROUTER_FILE
): ServiceFnLeaf[] {
  const file =
    project.getSourceFile(routerFile) ??
    project.addSourceFileAtPath(routerFile);
  project.resolveSourceFileDependencies();

  const root = file.getVariableDeclarationOrThrow("router").getInitializer();
  if (!root || !Node.isObjectLiteralExpression(root)) {
    throw new Error(`${routerFile}: \`router\` must be an object literal`);
  }

  const leaves: ServiceFnLeaf[] = [];
  const walk = (node: ObjectLiteralExpression, at: string[]) => {
    for (const property of node.getProperties()) {
      let key: string;
      let symbol: TsSymbol | undefined;
      let value: Node | undefined;
      if (Node.isShorthandPropertyAssignment(property)) {
        key = property.getName();
        // The name's own symbol is the property; the value is what it names.
        symbol = property.getValueSymbol();
      } else if (Node.isPropertyAssignment(property)) {
        key = property.getName();
        value = property.getInitializerOrThrow();
        if (Node.isIdentifier(value)) symbol = value.getSymbol();
      } else {
        throw new Error(
          `${property.getSourceFile().getFilePath()}: a router entry must be a property, not ${property.getKindName()}`
        );
      }

      const path = [...at, key];
      if (value && Node.isObjectLiteralExpression(value)) {
        walk(value, path);
        continue;
      }
      // `import * as sales from "./sales/sales.server"`: the module's API is
      // every service function the file exports, under its own name.
      const aliased = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
      const moduleFile = aliased?.getDeclarations().find(Node.isSourceFile);
      if (moduleFile) {
        for (const [name, declarations] of moduleFile.getExportedDeclarations()) {
          const declaration = declarations.find(Node.isVariableDeclaration);
          if (!declaration) {
            if (declarations.some((d) => Node.isTypeAliasDeclaration(d) || Node.isInterfaceDeclaration(d))) continue;
            throw new Error(
              `${moduleFile.getFilePath()}: export ${name} is not a defineServiceFn (a server file exports only service functions)`
            );
          }
          const call = defineCall(declaration);
          if (!call) {
            throw new Error(
              `${moduleFile.getFilePath()}: export ${name} is not a defineServiceFn (a server file exports only service functions)`
            );
          }
          leaves.push({ path: [...path, name], declaration, call });
        }
        continue;
      }
      const declaration = variableOf(symbol);
      const init = declaration?.getInitializer();
      if (!declaration || !init) {
        throw new Error(
          `router.${path.join(".")}: cannot find the declaration it names`
        );
      }
      const call = defineCall(declaration);
      if (call) {
        leaves.push({ path, declaration, call });
      } else if (Node.isObjectLiteralExpression(init)) {
        walk(init, path);
      } else {
        throw new Error(
          `router.${path.join(".")}: must be a namespace object or a defineServiceFn`
        );
      }
    }
  };
  walk(root, []);
  return leaves;
}

export interface LeafDocs {
  title: string;
  description: string;
  /** `@param name - text`: published on the input field of that name. */
  params: Record<string, string>;
  published: boolean;
  destructive: boolean;
  /** `@mcp read`: changes nothing, whatever its permission names. */
  read: boolean;
}

/** The leaf's TSDoc: the summary, `@remarks`, and `@mcp [destructive]`. */
export function leafDocs(leaf: ServiceFnLeaf): LeafDocs {
  const where = `router.${leaf.path.join(".")}`;
  const doc = leaf.declaration.getVariableStatement()?.getJsDocs().at(-1);
  const summary = doc?.getDescription().trim().split(/\n\s*\n/)[0] ?? "";
  const title = summary.replace(/\s+/g, " ").replace(/\.$/, "");
  const tags = doc?.getTags() ?? [];
  const text = (name: string) =>
    tags
      .find((tag) => tag.getTagName() === name)
      ?.getCommentText()
      ?.trim();
  const remarks = text("remarks");
  const returns = text("returns");
  const params: Record<string, string> = {};
  for (const tag of tags) {
    if (tag.getTagName() !== "param") continue;
    // `@param name - text`; ts-morph keeps the name in the comment for a
    // const, so it is read from the text either way.
    const raw = (tag.getText().replace(/^@param\s+/, "").replace(/\*\/\s*$/, ""))
      .replace(/\n\s*\*\s?/g, " ")
      .trim();
    const match = raw.match(/^([A-Za-z_$][\w$]*)\s*(?:-\s*)?([\s\S]*)$/);
    if (!match?.[2]) throw new Error(`${where}: @param needs a name and a text`);
    // A tag's text runs to the next tag, so it may end on the doc's `*`.
    params[match[1]!] = match[2]
      .replace(/\s+/g, " ")
      .replace(/(\s\*)+\s*$/, "")
      .trim();
  }
  const mcp = tags.filter((tag) => tag.getTagName() === "mcp");
  if (mcp.length > 1) throw new Error(`${where}: more than one @mcp tag`);
  const modifier = mcp[0]?.getCommentText()?.trim() ?? "";
  if (modifier !== "" && modifier !== "destructive" && modifier !== "read") {
    throw new Error(
      `${where}: @mcp takes nothing, "read" or "destructive", not "${modifier}"`
    );
  }
  if (mcp.length > 0 && !title) {
    throw new Error(`${where}: a published service function needs a summary`);
  }
  // A summary someone cut short: it is the tool's title and description.
  if (
    /(…|\.\.\.)$/.test(title) ||
    (title.match(/`/g)?.length ?? 0) % 2 === 1 ||
    (title.match(/\(/g)?.length ?? 0) !== (title.match(/\)/g)?.length ?? 0)
  ) {
    throw new Error(`${where}: the summary is cut off: "${title}"`);
  }
  const sentence = title ? `${title}.` : "";
  const parts = [sentence, remarks, returns ? `Returns ${returns}` : ""];
  return {
    title,
    description: parts.filter(Boolean).join("\n\n"),
    params,
    published: mcp.length > 0,
    destructive: modifier === "destructive",
    read: modifier === "read"
  };
}

function stringsOf(node: Node | undefined): string[] | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return [node.getLiteralValue()];
  if (Node.isArrayLiteralExpression(node)) {
    const values = node.getElements().map((element) => stringsOf(element));
    return values.every((v) => v?.length === 1)
      ? values.map((v) => v![0]!)
      : null;
  }
  return null;
}

/**
 * The permission's object literal: written in place, or a constant it names
 * (`service.closeJobPermission`, the one a ported posting body shares with
 * its callers), through `satisfies` / `as const`.
 */
function permissionLiteral(node: Node | undefined): Node | undefined {
  let current = node;
  for (let hops = 0; current && hops < 4; hops++) {
    if (Node.isSatisfiesExpression(current) || Node.isAsExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isIdentifier(current) || Node.isPropertyAccessExpression(current)) {
      const name = Node.isIdentifier(current) ? current : current.getNameNode();
      const declaration = name.getDefinitionNodes()[0];
      current = Node.isVariableDeclaration(declaration)
        ? declaration.getInitializer()
        : undefined;
      continue;
    }
    return current;
  }
  return current;
}

/** A union's members, or the type itself. */
function membersOf(type: Type): Type[] {
  return type.isUnion() ? type.getUnionTypes() : [type];
}

/** The page gates a type lists: one object per gate, each `{ page: level }`. */
function gatesOfType(type: Type, at: Node): [string, string][][] {
  return membersOf(type).map((gate) =>
    gate.getProperties().flatMap((property) => {
      const level = property.getTypeAtLocation(at).getNonNullableType();
      // An array literal's union gives each member the others' keys as `?: undefined`.
      if (level.isNever() || level.isUndefined()) return [];
      return [
        [
          property.getName(),
          level.isStringLiteral() ? String(level.getLiteralValue()) : ""
        ] as [string, string]
      ];
    })
  );
}

/**
 * An `anyOf` or row rule, read off its TYPE: a helper call
 * (`itemRule("Edit", { id: "itemId" })`) and a constant read like a literal.
 * The gates are each branch's `then` (a row rule) or entry (`anyOf`).
 */
function choiceGates(
  node: Node
): { kind: "anyOf" | "row"; gates: [string, string][][] } | null {
  const type = node.getType();
  const anyOf = type.getProperty("anyOf");
  if (anyOf) {
    const entry = anyOf.getTypeAtLocation(node).getNumberIndexType();
    return { kind: "anyOf", gates: entry ? gatesOfType(entry, node) : [] };
  }
  const row = type.getProperty("row");
  if (!row) return null;
  const rowCase = row
    .getTypeAtLocation(node)
    .getProperty("cases")
    ?.getTypeAtLocation(node)
    .getNumberIndexType();
  const gates = rowCase
    ? membersOf(rowCase).flatMap((member) => {
        const then = member.getProperty("then");
        return then ? gatesOfType(then.getTypeAtLocation(node), node) : [];
      })
    : [];
  return { kind: "row", gates };
}

/**
 * A rule that picks one page per call, as the manifest publishes it: every
 * page its branches name at one level, and what picks (`item.type`).
 */
function publishChoice(
  where: string,
  { kind, gates }: { kind: "anyOf" | "row"; gates: [string, string][][] }
): { permission: ToolPermission; actions: PermissionAction[] } {
  const levels = new Set<string>();
  const pages: string[] = [];
  for (const gate of gates) {
    const [entry, ...more] = gate;
    if (!entry || more.length > 0) {
      throw new Error(
        `${where}: each branch of a published ${kind} rule names one page`
      );
    }
    const [page, level] = checkedEntry(where, entry);
    levels.add(level);
    if (!pages.includes(page)) pages.push(page);
  }
  const [level] = levels;
  if (!level || levels.size > 1) {
    throw new Error(
      `${where}: a published ${kind} rule names its pages at one level`
    );
  }
  // Registry order: a union's member order moves with the checker's type ids.
  const order = PAGES.map((page) => page.id as string);
  pages.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const by =
    kind === "row"
      ? [
          ...new Set(
            pages.flatMap((page) => {
              const shared = pageById(page)?.where;
              return shared ? [`${shared.table}.${shared.column}`] : [];
            })
          )
        ]
      : [];
  const actions = ACTIONS.filter((action) =>
    levelHolds(level as Level, action)
  );
  const modules = new Set(pages.map(moduleOf));
  const [module] = modules;
  return {
    permission: {
      module: modules.size === 1 && module ? module : null,
      actions: modules.size === 1 ? actions : [],
      oneOf: { pages, level, by }
    },
    actions
  };
}

/**
 * The API gate's view of the declared permission: the module of its pages,
 * the page when the gate names one, and every action its levels hold. A gate
 * of pages of several modules publishes module `null` and each page and level
 * as `allOf`; a keyed rule over several modules publishes module `null` alone.
 * `"employee"` (any employee of the company) publishes no page. A keyed rule publishes every
 * page its rules name; an `anyOf` or row rule also publishes them as `oneOf`.
 * `"system"` is refused.
 */
export function leafPermission(leaf: ServiceFnLeaf): {
  permission: ToolPermission;
  actions: PermissionAction[];
} {
  const where = `router.${leaf.path.join(".")}`;
  const definition = leaf.call.getArguments()[0];
  const property =
    definition && Node.isObjectLiteralExpression(definition)
      ? definition.getProperty("permission")
      : undefined;
  const value = permissionLiteral(
    property && Node.isPropertyAssignment(property)
      ? property.getInitializer()
      : undefined
  );
  if (!value) throw new Error(`${where}: no literal \`permission\``);

  // `"employee"`: any employee of the company, or a key holding some grant
  // there (`admits`). No page to publish.
  if (Node.isStringLiteral(value) && value.getLiteralValue() === "employee") {
    return { permission: { module: null, actions: [] }, actions: [] };
  }

  const choice = choiceGates(value);
  if (choice)
    return publishChoice(
      where,
      choice.kind === "anyOf"
        ? {
            kind: "anyOf",
            gates: alternativesOf(
              readGate({ anyOf: choice.gates.map(asGate) })
            )
          }
        : choice
    );

  if (!Node.isObjectLiteralExpression(value)) {
    throw new Error(
      `${where}: a published service function names its permission ({ "<page>": "<Level>" }), not ${value.getText()}`
    );
  }
  // A keyed rule publishes every page its rules name: the gate picks one
  // rule by the input, the manifest describes them all.
  let gates = [value];
  if (value.getProperty("by")) {
    const rules = value.getProperty("rules");
    const literal =
      rules && Node.isPropertyAssignment(rules)
        ? permissionLiteral(rules.getInitializer())
        : undefined;
    const values =
      literal && Node.isObjectLiteralExpression(literal)
        ? literal
            .getProperties()
            .map((rule) =>
              Node.isPropertyAssignment(rule)
                ? permissionLiteral(rule.getInitializer())
                : undefined
            )
        : [];
    if (
      !values.length ||
      !values.every((v) => v !== undefined && Node.isObjectLiteralExpression(v))
    ) {
      throw new Error(
        `${where}: a published keyed permission names a literal page gate for every value, not ${value.getText()}`
      );
    }
    gates = values as ObjectLiteralExpression[];
  }

  // Publish what `defineServiceFn` checks: the rule as its read (`readGate`),
  // every page a widened read admits.
  const entries = gates.map((gate) => entriesOf(where, gate));
  const asRule = entries.map(asGate);
  const read = readGate(
    gates.length === 1 && !value.getProperty("by")
      ? asRule[0]!
      : {
          by: "value",
          rules: Object.fromEntries(asRule.map((gate, i) => [i, gate]))
        }
  );
  const reads = ("rules" in read ? Object.values(read.rules) : [read]).map(
    (gate) => alternativesOf(gate as AnyGate)
  );
  if (reads.length === 1 && reads[0]!.length > 1)
    return publishChoice(where, { kind: "anyOf", gates: reads[0]! });

  const modules = new Set<string>();
  const pages = new Set<string>();
  const actions = new Set<PermissionAction>();
  for (const read of reads) {
    if (read.length < 2) continue;
    for (const gate of read as [string, string][][]) {
      const page = gate[0]?.[0];
      if (!page) continue;
      modules.add(moduleOf(page));
      pages.add(page);
    }
  }
  for (const [page, level] of entries.flat()) {
    modules.add(moduleOf(page));
    pages.add(page);
    for (const action of ACTIONS) {
      if (levelHolds(level as Level, action)) actions.add(action);
    }
  }
  const held = ACTIONS.filter((action) => actions.has(action));
  const [module] = modules;
  const [page] = pages;
  if (modules.size === 1 && module) {
    return {
      permission: {
        module,
        ...(pages.size === 1 && page ? { page } : {}),
        actions: held
      },
      actions: held
    };
  }
  // One gate over pages of several modules needs every entry: publish them all.
  if (entries.length === 1) {
    const order = PAGES.map((page) => page.id as string);
    const allOf = [...entries[0]!]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([page, level]) => ({ page, level }));
    return { permission: { module: null, actions: held, allOf }, actions: held };
  }
  return { permission: { module: null, actions: [] }, actions: held };
}

/** A gate literal's `[page, level]` entries, each checked (`checkedEntry`). */
function entriesOf(
  where: string,
  gate: ObjectLiteralExpression
): [string, string][] {
  return gate.getProperties().map((entry) => {
    const page = literalName(entry);
    const level = Node.isPropertyAssignment(entry)
      ? stringsOf(entry.getInitializer())
      : null;
    return checkedEntry(where, [
      page ?? entry.getText(),
      level?.length === 1 ? level[0]! : ""
    ]);
  });
}

/** `[page, level]` when the page is the registry's and the level a gate level; else throws. */
function checkedEntry(
  where: string,
  [page, level]: [string, string]
): [string, string] {
  if (!pageById(page)) {
    throw new Error(
      `${where}: permission names a page of the registry ({ "inventory.receipts": "Edit" }), not ${page}`
    );
  }
  if (!GATE_LEVELS.includes(level)) {
    throw new Error(
      `${where}: permission.${page} must be one of ${GATE_LEVELS.join(", ")}`
    );
  }
  return [page, level];
}

const asGate = (entries: [string, string][]) =>
  Object.fromEntries(entries) as PageGate;

/** A gate as the alternatives of which any one passes, each as its entries. */
function alternativesOf(gate: AnyGate): [string, string][][] {
  const list = "anyOf" in gate ? gate.anyOf : Array.isArray(gate) ? gate : [gate];
  return list.map(
    (alternative: PageGate) => Object.entries(alternative) as [string, string][]
  );
}

function classify(
  actions: PermissionAction[],
  destructive: boolean,
  read = false
): Classification {
  if (read) return "READ";
  if (destructive || actions.includes("delete")) return "DESTRUCTIVE";
  return actions.length > 0 && actions.every((a) => a === "view")
    ? "READ"
    : "WRITE";
}

/**
 * The checker orders a union's members by its own type ids, which move when
 * the program's files change, so an unrelated edit reordered an enum and
 * changed the schema's digest. JSON Schema gives `enum` no order: sort it.
 */
function sortEnums(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "enum" && Array.isArray(value)) {
      out[key] = [...value].sort();
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" ? sortEnums(item as JsonSchema) : item
      );
    } else if (value && typeof value === "object") {
      out[key] = sortEnums(value as JsonSchema);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function schemasOf(leaf: ServiceFnLeaf): {
  input: JsonSchema;
  response?: JsonSchema;
} {
  const at = leaf.declaration;
  const signature = at.getType().getCallSignatures()[0];
  const parameter = signature?.getParameters()[1];
  if (!signature || !parameter) {
    throw new Error(`router.${leaf.path.join(".")}: not a callable service function`);
  }
  const input = typeToJsonSchema(
    parameter.getTypeAtLocation(at),
    at,
    0,
    new Set(),
    true
  );
  const response = typeToJsonSchema(
    unwrapResponseType(signature.getReturnType(), at),
    at
  );
  return {
    input: Object.keys(input).length > 0 ? sortEnums(input) : { type: "object" },
    ...(Object.keys(response).length > 0
      ? { response: sortEnums(response) }
      : {})
  };
}

/**
 * A `paged` result (`{ rows, count }`) is a list the function pages itself:
 * published as its rows, with `paginates`, so HTTP sends `{ results, count }`
 * and MCP fills `limit`/`offset`.
 */
function pagedRows(response: JsonSchema | undefined): JsonSchema | undefined {
  const properties = (response as { properties?: Record<string, JsonSchema> })
    ?.properties;
  if (!properties) return undefined;
  const keys = Object.keys(properties).sort();
  if (keys.join() !== "count,rows") return undefined;
  return properties.rows;
}

/** The published leaves as manifest entries. */
export function buildServiceFnTools(
  project: Project,
  routerFile = ROUTER_FILE,
  leaves = routerLeaves(project, routerFile)
): ManifestEntry[] {
  return leaves.flatMap((leaf) => {
    const docs = leafDocs(leaf);
    if (!docs.published) return [];
    const where = `router.${leaf.path.join(".")}`;
    if (leaf.path.length < 2) {
      throw new Error(`${where}: a published leaf needs a module namespace`);
    }
    const { permission, actions } = leafPermission(leaf);
    const writes = actions.filter((action) => action !== "view");
    if (docs.read && writes.length > 0) {
      // A READ tool is offered as safe to run unasked; a permission that
      // names a write says the function may change something.
      throw new Error(
        `${where}: @mcp read on a function whose permission names ${writes.join(", ")}; drop "read" or gate it on view`
      );
    }
    const { input, response: returned } = schemasOf(leaf);
    const rows = pagedRows(returned);
    if (rows && ![rows.type].flat().includes("array")) {
      throw new Error(
        `${where}: a paged result's rows must be a list, not ${JSON.stringify(rows.type ?? rows)}`
      );
    }
    const response = rows ?? returned;
    const properties = (input as { properties?: Record<string, JsonSchema> })
      .properties;
    for (const [name, text] of inputFieldDescriptions(leaf.call)) {
      const property = properties?.[name];
      if (property && !property.description) property.description = text;
    }
    // A loose input that reaches `setGenericQueryFilters` takes the list
    // filters too; they were accepted but published nowhere.
    if (
      properties &&
      (input as { additionalProperties?: unknown }).additionalProperties !==
        undefined &&
      appliesGenericFilters(leaf.call)
    ) {
      properties.filters ??= GENERIC_FILTERS_SCHEMA;
      properties.sorts ??= GENERIC_SORTS_SCHEMA;
    }
    for (const [name, text] of Object.entries(docs.params)) {
      const property = properties?.[name];
      if (!property) {
        throw new Error(`${where}: @param ${name} is not a field of its input`);
      }
      property.description = text;
    }
    return [
      {
        name: leaf.path.join("_"),
        module: leaf.path[0]!,
        classification: classify(actions, docs.destructive, docs.read),
        title: docs.title,
        description: docs.description,
        permission,
        paginates: rows !== undefined,
        schema: input,
        ...(response ? { responseSchema: response } : {}),
        serviceFn: { path: leaf.path }
      }
    ];
  });
}
