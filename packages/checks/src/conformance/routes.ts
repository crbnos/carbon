// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { posix } from "node:path";
import type { Program } from "oxc-parser";
import {
  type Check,
  defineCheck,
  eachFile,
  type Scan,
  type SourceFile,
  type Violation
} from "../check";
import { pluginFindings, routeTypescript, typescript } from "../sources/inputs";
import { loadModuleServerFiles } from "../sources/modules";
import { type Node, parseTypescript, walk } from "../sources/syntax";
import { lineOf } from "../sources/text";

// Routes: rules for the React Router route modules of the apps. A route writes
// and reads through service functions, an index route that only redirects runs
// its redirect before its parents' loaders, and a page under /x neither copies
// its loader data into state nor keeps its state when the record changes.

const ID = "route-action-shape";

/**
 * The rule itself is a rule of the `carbon` oxlint plugin,
 * `oxlint-plugins/carbon.mjs`, so the editor shows it; this reads what the
 * plugin reports.
 *
 * It fails a write in an ERP route: a `.from(…)` insert, upsert, update or
 * delete, a Kysely `insertInto`/`updateTable`/`deleteFrom`, or an
 * `invokePosting(`/`invokePostingOrThrow(`/`invokeCreate(` call (a posting
 * body run outside its service function). The write belongs in a
 * `defineServiceFn` the route calls, so the API and MCP run the same logic
 * (`.ai/plans/2026-10-15-service-function-migration.md`).
 *
 * oxlint matches the parsed call. So a comment or a line break inside the
 * chain does not hide a write, and a write named in a comment or a string
 * does not match. A route that calls a write building block from a
 * `.service.ts` is not detected. The root `oxlint.config.ts` enables the plugin for
 * ERP routes and leaves out test files. The baseline holds auth routes only
 * (the OAuth routes, invite, unlock, account security and passkeys).
 */
export const routeActionShape = defineCheck({
  id: ID,
  description:
    "An ERP route writes only through a service function: no client, Kysely or posting writes in the route",
  provenance: {
    deprecates: "a route action that composes writes itself",
    replacedBy:
      "one `defineServiceFn` per operation, called through `authorize(request)`",
    since: "2026-10-15"
  },
  reads: { findings: pluginFindings },
  find: ({ findings }) =>
    findings
      .filter((finding) => finding.checkId === ID)
      .map((finding) => finding.violation)
});

// An index route that renders nothing exists to redirect (`/x/issue/:id` →
// `…/details`). React Router runs the loaders of a matched branch in parallel,
// so its parents' loaders ran in full for a request that was about to be
// redirected: one hover prefetch of a bare issue link cost ~20 queries, thrown
// away, and a click cost them twice. Exporting the redirect as middleware runs
// it before any loader.
const INDEX_ROUTE = /\/app\/routes\/(?:.*[/.])?_index\.tsx$/;
const LOADER = /^export\s+(?:async\s+function|function|const)\s+loader\b/m;
const DEFAULT_EXPORT = /^export\s+default\b|^export\s*\{[^}]*\bdefault\b/m;
const REDIRECT = /\bredirect\s*\(/;
const MIDDLEWARE =
  /^export\s+const\s+middleware\b[^;]*\bredirectBeforeLoaders\s*\(\s*loader\s*\)/m;

export const indexRedirectBeforeLoaders = defineCheck({
  files: routeTypescript,
  id: "index-redirect-before-loaders",
  description:
    "An index route that only redirects must run the redirect before its parents' loaders",
  provenance: {
    deprecates:
      "a redirect-only index route whose redirect runs alongside its parents' loaders",
    replacedBy:
      "export const middleware = [redirectBeforeLoaders(loader)] (@carbon/utils)",
    since: "2026-10-02"
  },
  scan(file: string, contents: string): Violation[] {
    if (!INDEX_ROUTE.test(file)) return [];
    const loader = LOADER.exec(contents);
    // A route with a default export renders a page; one without a redirect is
    // a resource route. Neither is a redirect-only route.
    if (!loader || DEFAULT_EXPORT.test(contents) || !REDIRECT.test(contents)) {
      return [];
    }
    if (MIDDLEWARE.test(contents)) return [];
    const line = lineOf(contents, loader.index);
    return [
      {
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message:
          "Add `export const middleware = [redirectBeforeLoaders(loader)];` (@carbon/utils) so the redirect runs before the parents' loaders"
      }
    ];
  }
});

// `useState(initial)` reads `initial` once. Seeded from loader or route data,
// the state is a copy that no reload updates: a quote's totals kept a deleted
// line until the page was reloaded, because they were summed from lines copied
// into state at mount. Loaded data changes under a mounted component all the
// time (a save's revalidation, a realtime reload, a layout that reloads after
// its page mounts).
//
// What to write instead:
// - a value computed from the data: compute it during render (`useMemo`);
// - the user's own choices over the data: keep only the choices in state and
//   combine them with the current data during render;
// - a draft the user edits: render it in a component keyed on what it drafts.
//
// This sees only a hook result used by name in the same file. A copy seeded
// from a prop is not found.
const SOURCE =
  /const\s+(\{[^}]*\}|\w+)\s*=\s*use(?:LoaderData|RouteData|RouteLoaderData)\b/g;
const STATE = /\buseState\s*(?:<[^;(]*?>)?\s*\(/g;

function boundNames(pattern: string): string[] {
  if (!pattern.startsWith("{")) return [pattern];
  return pattern
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/^\.\.\./, "")
        .split(":")
        .pop()!
        .split("=")[0]!
        .trim()
    )
    .filter((name) => /^\w+$/.test(name));
}

/** The text between the parenthesis at `open` and its match. */
function argument(contents: string, open: number): string {
  let depth = 0;
  for (let i = open; i < contents.length && i < open + 2000; i++) {
    const char = contents[i];
    if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return contents.slice(open + 1, i);
  }
  return "";
}

export const noStateCopyOfLoaderData = defineCheck({
  files: typescript,
  id: "no-state-copy-of-loader-data",
  description:
    "state must not be seeded from loader or route data: it is a copy no reload updates",
  provenance: {
    deprecates: "useState(valueFrom(useLoaderData() | useRouteData()))",
    replacedBy:
      "a value computed during render, or a component keyed on what it drafts",
    since: "2026-10-06"
  },
  scan(file: string, contents: string): Violation[] {
    if (!file.endsWith(".tsx")) return [];
    const names = [...contents.matchAll(SOURCE)].flatMap((match) =>
      boundNames(match[1]!)
    );
    if (names.length === 0) return [];
    const used = new RegExp(`(?<![.\\w])(?:${names.join("|")})\\b(?!\\s*:)`);

    const violations: Violation[] = [];
    for (const match of contents.matchAll(STATE)) {
      const open = match.index + match[0].length - 1;
      const initial = argument(contents, open);
      const name = initial.match(used)?.[0];
      if (!name) continue;
      const line = lineOf(contents, match.index);
      violations.push({
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message: `State seeded from \`${name}\` (loader or route data) is a copy that no reload updates. Compute it during render, or keep only the user's input in state`
      });
    }
    return violations;
  }
});

const LOADER_ROUTES = /^apps\/erp\/app\/routes\//;
const SERVER_FILE =
  /^apps\/erp\/app\/modules\/([a-z-]+)\/\1(?:\.ee)?\.server\.ts$/;
const SERVICE_IMPORT = /modules\/([a-z-]+)\/\1(?:\.ee)?\.service$/;

/**
 * `<module>.<name>` for every building block a service function calls
 * (`service.<name>(…)` in `<module>.server.ts`). A building block no service
 * function calls is a helper, and a loader may call it directly.
 */
export function wrappedBuildingBlocks(serverFiles: SourceFile[]): Set<string> {
  const wrapped = new Set<string>();
  for (const { file, contents } of serverFiles) {
    const module = SERVER_FILE.exec(file)?.[1];
    if (!module) continue;
    for (const m of contents.matchAll(/\bservice\.(\w+)\(/g)) {
      wrapped.add(`${module}.${m[1]}`);
    }
  }
  return wrapped;
}

/** The `loader` the route declares at its top level, exported or not. */
function loaderBody(program: Program): Node | null | undefined {
  for (const topLevel of program.body) {
    const statement =
      (topLevel.type === "ExportNamedDeclaration" ||
        topLevel.type === "ExportDefaultDeclaration") &&
      topLevel.declaration
        ? topLevel.declaration
        : topLevel;
    if (
      (statement.type === "FunctionDeclaration" ||
        statement.type === "TSDeclareFunction") &&
      statement.id?.name === "loader"
    ) {
      return statement.body;
    }
    if (statement.type === "VariableDeclaration") {
      for (const d of statement.declarations) {
        if (d.id.type === "Identifier" && d.id.name === "loader") return d.init;
      }
    }
  }
  return undefined;
}

export const LOADER_READS_THROUGH_API = "loader-reads-through-api";

const ABOUT = {
  id: LOADER_READS_THROUGH_API,
  description:
    "An ERP route loader calls a wrapped building block through its service function, not directly",
  provenance: {
    deprecates:
      "a loader that calls a `.service` building block a service function wraps",
    replacedBy: "`api.<module>.<fn>(input)` from `authorize(request, gate)`",
    since: "2026-10-18"
  }
};

/**
 * An ERP route loader reads through the service functions
 * (`api.<module>.<fn>(input)`, `const { api } = await authorize(request, gate)`), never by calling a
 * building block that a service function wraps: the loader and an API or
 * MCP caller then pass the same permission gate.
 *
 * Only the `loader` is read; actions are not scanned. The baseline holds the
 * reads that stay direct on purpose: service-role reads, reads for another
 * company of the group, reads whose page derives its types from the building
 * block, and the write-on-GET `upsertPickMethod` calls.
 */
export function loaderReadsThroughApi(wrapped: Set<string>): { scan: Scan } {
  return {
    scan(file: string, contents: string): Violation[] {
      if (!LOADER_ROUTES.test(file) || !contents.includes(".service"))
        return [];
      const { program } = parseTypescript(file, contents);
      // local name -> `<module>.<name>`, for value imports of a service file
      const imported = new Map<string, string>();
      // namespace name -> `<module>`, for `import * as x` of a service file
      const namespaces = new Map<string, string>();
      for (const statement of program.body) {
        if (statement.type !== "ImportDeclaration") continue;
        const module = SERVICE_IMPORT.exec(statement.source.value)?.[1];
        if (!module || statement.importKind === "type") continue;
        for (const specifier of statement.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            namespaces.set(specifier.local.name, module);
          }
          if (
            specifier.type !== "ImportSpecifier" ||
            specifier.importKind === "type"
          ) {
            continue;
          }
          const name =
            specifier.imported.type === "Literal"
              ? specifier.imported.value
              : specifier.imported.name;
          imported.set(specifier.local.name, `${module}.${name}`);
        }
      }
      const body = loaderBody(program);
      if (!body || imported.size + namespaces.size === 0) return [];

      const calledBlock = (callee: Node): string | undefined => {
        if (callee.type === "Identifier") return imported.get(callee.name);
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier"
        ) {
          const module = namespaces.get(callee.object.name);
          if (module) return `${module}.${callee.property.name}`;
        }
        return undefined;
      };

      const violations: Violation[] = [];
      walk(body, (node) => {
        if (node.type !== "CallExpression") return;
        const block = calledBlock(node.callee);
        if (block && wrapped.has(block)) {
          violations.push({
            file,
            line: lineOf(contents, node.start),
            snippet: block,
            message: `Call ${block} through its service function: api.${block}(input), with api from authorize(request, gate)`
          });
        }
      });
      return violations;
    }
  };
}

export const loaderReadsThroughApiCheck = defineCheck({
  ...ABOUT,
  reads: { routes: routeTypescript, modules: loadModuleServerFiles },
  find: ({ routes, modules }) =>
    eachFile(
      routes,
      loaderReadsThroughApi(wrappedBuildingBlocks(modules.map((f) => f.server)))
        .scan
    )
});

// React Router keeps a route's components mounted when only its params change
// (part A to part B, one order line to the next). Whatever the page seeded once
// from its record — a form's default values, an editor's initial content, a
// `useState` copy — then belongs to the previous record: a notes editor showed
// record A's notes on record B and the first keystroke saved them there.
// `RecordOutlet` remounts the page when it is shown for a different record.
const OUTLET_ROUTES = /^apps\/(?:erp|mes)\/app\/routes\/x\+\//;
const OUTLET = /<Outlet(?=[\s/>])([^>]*)>/g;

/** `no-bare-outlet` over one route file: an outlet the file renders itself. */
export function scanBareOutlets(file: string, contents: string): Violation[] {
  if (!OUTLET_ROUTES.test(file)) return [];
  const violations: Violation[] = [];
  for (const match of contents.matchAll(OUTLET)) {
    // An outlet with its own key already says when its page remounts (the
    // shell keys on the company).
    if (/\bkey=/.test(match[1]!)) continue;
    const line = lineOf(contents, match.index);
    const text = contents.split("\n")[line - 1]?.trim() ?? "";
    if (text.startsWith("//") || text.startsWith("*")) continue;
    violations.push({
      file,
      line,
      snippet: text,
      message:
        'Render `<RecordOutlet />` from "@carbon/react": a plain outlet keeps the page mounted when the record changes, with the previous record\'s form and editor state'
    });
  }
  return violations;
}

export const noBareOutlet = defineCheck({
  id: "no-bare-outlet",
  description:
    "a route under /x renders RecordOutlet, which remounts its page when the record changes",
  provenance: {
    deprecates: "<Outlet />",
    replacedBy: '<RecordOutlet /> from "@carbon/react"',
    since: "2026-10-06"
  },
  reads: { files: typescript },
  find: ({ files }) => [
    ...eachFile(files, scanBareOutlets),
    ...findNestedOutlets(files)
  ]
});

// A file that renders its own outlet must not also render a component that
// renders one. Both outlets render the same child route, so a route dialog
// opens twice: two "New API Key" modals with the same input ids, each setting
// `aria-hidden` on the other, so assistive technology found no field in either.
// The per-file scan above reads routes only, and a component's outlet sits in
// `modules/` or `components/`. This finder follows imports across files: a
// component renders an outlet when its file does, or when it renders such a
// component. An import names a component by its file (`~/…/ApiKeysTable`,
// `./ApiKeysTable`), or by its file's name through a barrel above it
// (`{ ApiKeysTable }` from `~/modules/settings/ui`).
//
// The same bug opened New Webhook and a supplier's New Process twice. Because
// the import names the file, a same-named component elsewhere is not taken
// for it. A barrel that renames its export is not followed. The finder reads
// the whole file, not its branches: an outlet behind an early return is
// flagged too, because the rule is one outlet per route. The baselined
// supplier processes route keeps its `SupplierProcesses` outlet until that
// card gets its own fix.
const APP_TSX = /^apps\/(erp|mes)\/app\/.+\.tsx$/;
const ROUTE_TSX = /^apps\/(?:erp|mes)\/app\/routes\//;
const ANY_OUTLET = /<(?:Record)?Outlet(?=[\s/>])/;
const IMPORT =
  /import\s+(?!type\s)(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s*["']([^"']+)["']/g;

const isCommentLine = (text: string) => /^(?:\/\/|\*|\/\*|\{\/\*)/.test(text);

/** The file's lines with comment lines blanked, so a mention is not a render. */
const codeLines = (contents: string) =>
  contents.split("\n").map((line) => (isCommentLine(line.trim()) ? "" : line));

const componentName = (file: string) => {
  const parts = file.split("/");
  const base = parts[parts.length - 1]!.split(".")[0]!;
  return base === "index" ? parts[parts.length - 2]! : base;
};

const stem = (file: string) => file.replace(/\.tsx?$/, "");

/** An import's repo path without extension, or null for a package import. */
const resolveImport = (file: string, app: string, specifier: string) => {
  if (specifier.startsWith("~/")) {
    return stem(`apps/${app}/app/${specifier.slice(2)}`);
  }
  if (specifier.startsWith(".")) {
    return stem(posix.join(posix.dirname(file), specifier));
  }
  return null;
};

type Binding = { local: string; imported: string; from: string };

const importBindings = (file: string, app: string, code: string) => {
  const bindings: Binding[] = [];
  for (const [, defaultName, named, specifier] of code.matchAll(IMPORT)) {
    const from = resolveImport(file, app, specifier!);
    if (!from) continue;
    if (defaultName) {
      bindings.push({ local: defaultName, imported: "default", from });
    }
    for (const part of named?.split(",") ?? []) {
      const [imported, local = imported] = part.trim().split(/\s+as\s+/);
      if (!imported || imported.startsWith("type ")) continue;
      bindings.push({ local: local!, imported, from });
    }
  }
  return bindings;
};

// A JSX tag, not a type argument: `useColumns<Part>(` and `<Grid<Part>` follow
// a name or a bracket.
const tagPattern = (name: string) =>
  new RegExp(`(?<![\\w$.)\\]])<${name}(?=[\\s/>])`);

type OutletComponent = { file: string; name: string; chain: string[] };

// From the component's own file, only its default export or the export named
// after the file counts: another export of that file renders no outlet.
// A default import through a folder's index (`import Panel from "~/components/Panel"`)
// is matched by its local name.
const importsComponent = (binding: Binding, owner: OutletComponent) => {
  const ownFile =
    stem(owner.file) === binding.from ||
    stem(owner.file) === `${binding.from}/index`;
  if (ownFile) {
    return binding.imported === "default" || binding.imported === owner.name;
  }
  return (
    (binding.imported === "default" ? binding.local : binding.imported) ===
      owner.name && owner.file.startsWith(`${binding.from}/`)
  );
};

export function findNestedOutlets(files: SourceFile[]): Violation[] {
  const sources = files.flatMap(({ file, contents }) => {
    const app = APP_TSX.exec(file)?.[1];
    if (!app) return [];
    const lines = codeLines(contents);
    const code = lines.join("\n");
    return [
      {
        file,
        lines,
        code,
        isRoute: ROUTE_TSX.test(file),
        hasOutlet: ANY_OUTLET.test(code),
        bindings: importBindings(file, app, code)
      }
    ];
  });

  /** The components this file renders that render an outlet, by local name. */
  const rendered = (
    source: (typeof sources)[number],
    owners: Map<string, OutletComponent>
  ) => {
    const found: { local: string; owner: OutletComponent }[] = [];
    for (const binding of source.bindings) {
      if (!source.code.includes(`<${binding.local}`)) continue;
      if (!tagPattern(binding.local).test(source.code)) continue;
      for (const owner of owners.values()) {
        if (owner.file === source.file || !importsComponent(binding, owner)) {
          continue;
        }
        found.push({ local: binding.local, owner });
        break;
      }
    }
    return found;
  };

  // Components that render an outlet, directly or through another component.
  const owners = new Map<string, OutletComponent>();
  for (const source of sources) {
    if (source.isRoute || !source.hasOutlet) continue;
    owners.set(source.file, {
      file: source.file,
      name: componentName(source.file),
      chain: [source.file]
    });
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const source of sources) {
      if (source.isRoute || owners.has(source.file)) continue;
      const [first] = rendered(source, owners);
      if (!first) continue;
      owners.set(source.file, {
        file: source.file,
        name: componentName(source.file),
        chain: [source.file, ...first.owner.chain]
      });
      grew = true;
    }
  }

  const violations: Violation[] = [];
  for (const source of sources) {
    if (!source.hasOutlet) continue;
    for (const { local, owner } of rendered(source, owners)) {
      const tag = tagPattern(local);
      source.lines.forEach((text, index) => {
        if (!tag.test(text)) return;
        violations.push({
          file: source.file,
          line: index + 1,
          snippet: text.trim(),
          message: `<${local}> renders an outlet (${owner.chain.join(" → ")}) and this file renders its own. Where both render, the child route mounts twice. Remove the component's outlet and keep the route's <RecordOutlet />`
        });
      });
    }
  }
  return violations;
}

/** The routes checks, in the order they are written above. */
export const checks: Check[] = [
  routeActionShape,
  indexRedirectBeforeLoaders,
  noStateCopyOfLoaderData,
  loaderReadsThroughApiCheck,
  noBareOutlet
];
