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
import type { ManifestEntry, PermissionAction, ToolPermission } from "@carbon/api";
import {
  classify,
  GENERIC_FILTERS_SCHEMA,
  GENERIC_SORTS_SCHEMA,
  operationDescription
} from "@carbon/api/catalog.server";
import type { Publish } from "@carbon/api/service-fn.server";
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type Symbol as TsSymbol,
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

const ACTIONS: PermissionAction[] = ["view", "create", "update", "delete"];

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

export interface LeafPublication {
  publish: Publish | undefined;
  title: string;
  description: string | undefined;
}

function literalText(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return undefined;
}

/**
 * `publish`, `title` and `description` as written on the definition — the
 * same values the runtime catalog reads. A doc block may remain for anything
 * else; a leftover `@mcp` or `@param` tag is the old channel and fails.
 */
export function leafPublication(leaf: ServiceFnLeaf): LeafPublication {
  const where = `router.${leaf.path.join(".")}`;
  const definition = leaf.call.getArguments()[0];
  // The runtime catalog reads the evaluated definition; this reads the source.
  // A value it cannot read (a spread, a shorthand property) would silently
  // leave the manifest, the docs and the digest short of an operation the API
  // and the MCP publish, so it fails here instead.
  if (definition && Node.isObjectLiteralExpression(definition)) {
    for (const entry of definition.getProperties()) {
      if (Node.isSpreadAssignment(entry)) {
        throw new Error(
          `${where}: the definition spreads ${entry.getExpression().getText()}; write publish, title and description as literal properties`
        );
      }
      if (
        Node.isShorthandPropertyAssignment(entry) &&
        ["publish", "title", "description"].includes(entry.getName())
      ) {
        throw new Error(
          `${where}: \`${entry.getName()}\` must be a literal property, not a shorthand`
        );
      }
    }
  }
  const property = (name: string) => {
    const entry =
      definition && Node.isObjectLiteralExpression(definition)
        ? definition.getProperty(name)
        : undefined;
    return entry && Node.isPropertyAssignment(entry)
      ? entry.getInitializer()
      : undefined;
  };
  const tags = leaf.declaration
    .getVariableStatement()
    ?.getJsDocs()
    .flatMap((doc) => doc.getTags().map((tag) => tag.getTagName()));
  for (const tag of ["mcp", "param"]) {
    if (tags?.includes(tag)) {
      throw new Error(
        `${where}: @${tag} is no longer read; publish with \`publish\`, \`title\` and \`description\` on the definition and \`.describe()\` on the field`
      );
    }
  }
  const publishNode = property("publish");
  let publish: Publish | undefined;
  if (publishNode) {
    const text = publishNode.getText();
    const value = literalText(publishNode);
    if (text === "true") publish = true;
    else if (value === "read" || value === "destructive") publish = value;
    else {
      throw new Error(
        `${where}: publish takes true, "read" or "destructive", not ${text}`
      );
    }
  }
  const titleNode = property("title");
  const title = literalText(titleNode)?.trim() ?? "";
  if (publish && !title) {
    throw new Error(
      `${where}: a published service function needs a literal \`title\``
    );
  }
  if (titleNode && !literalText(titleNode)) {
    throw new Error(`${where}: \`title\` must be a string literal`);
  }
  // A title someone cut short: it is the tool's title and description.
  if (
    /(…|\.\.\.)$/.test(title) ||
    (title.match(/`/g)?.length ?? 0) % 2 === 1 ||
    (title.match(/\(/g)?.length ?? 0) !== (title.match(/\)/g)?.length ?? 0)
  ) {
    throw new Error(`${where}: the title is cut off: "${title}"`);
  }
  const descriptionNode = property("description");
  if (descriptionNode && literalText(descriptionNode) === undefined) {
    throw new Error(
      `${where}: \`description\` must be a string or template literal without substitutions`
    );
  }
  return {
    publish,
    title,
    description: literalText(descriptionNode)?.trim() || undefined
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
 * The API gate's view of the declared permission. The gate checks one module;
 * a permission naming several modules publishes module `null` (membership
 * only) and the function's own gate decides, as it does for `{}` (any member
 * of the company). `"system"` and a keyed rule are refused.
 */
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

  if (!Node.isObjectLiteralExpression(value)) {
    throw new Error(
      `${where}: a published service function names its permission ({ update: "<module>" }), not ${value.getText()}`
    );
  }
  if (value.getProperty("by")) {
    throw new Error(`${where}: a keyed permission cannot be published yet`);
  }

  const modules = new Set<string>();
  const actions: PermissionAction[] = [];
  for (const action of ACTIONS) {
    const entry = value.getProperty(action);
    if (!entry) continue;
    const names = Node.isPropertyAssignment(entry)
      ? stringsOf(entry.getInitializer())
      : null;
    if (!names || names.length === 0) {
      throw new Error(`${where}: permission.${action} must be string literals`);
    }
    for (const name of names) modules.add(name);
    actions.push(action);
  }
  // `{}`: any member of the company (the caller's own account, a membership
  // read). The API gate then checks only that the key is the company's.
  const [module] = modules;
  return {
    permission:
      modules.size === 1 && module ? { module, actions } : { module: null, actions: [] },
    actions
  };
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
    const docs = leafPublication(leaf);
    if (!docs.publish) return [];
    const where = `router.${leaf.path.join(".")}`;
    if (leaf.path.length < 2) {
      throw new Error(`${where}: a published leaf needs a module namespace`);
    }
    const name = leaf.path.join("_");
    const { permission, actions } = leafPermission(leaf);
    // The same rule the runtime catalog applies (a "read" that writes throws).
    const classification = classify(name, docs.publish, actions);
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
      properties.filters ??= GENERIC_FILTERS_SCHEMA as JsonSchema;
      properties.sorts ??= GENERIC_SORTS_SCHEMA as JsonSchema;
    }
    return [
      {
        name,
        module: leaf.path[0]!,
        classification,
        title: docs.title,
        description: operationDescription(docs.title, docs.description),
        permission,
        paginates: rows !== undefined,
        schema: input,
        ...(response ? { responseSchema: response } : {}),
        serviceFn: { path: leaf.path }
      }
    ];
  });
}
