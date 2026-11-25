// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  BindingPattern,
  CallExpression,
  Directive,
  Expression,
  ObjectProperty,
  Statement
} from "oxc-parser";
import {
  type Check,
  defineCheck,
  type ModuleDir,
  type SourceFile,
  type Violation
} from "../check";
import { erpModules, typescript } from "../sources/inputs";
import { maskClientCode } from "../sources/server-files";
import { loadSideEffectPackages } from "../sources/side-effect-packages";
import { declarationOf, parseTypescript } from "../sources/syntax";
import { lineOf } from "../sources/text";
import { loadTypescriptFiles } from "../sources/typescript";

// Modules: rules for how the apps' code is split into files. An ERP module has
// one service, models and server file and no barrel, and its server file holds
// only service functions. Browser code never imports a server-only file, a file
// both apps need lives in a package, and a file imported for its side effects
// is listed in its package's "sideEffects".

/** Literal entries every module must contain. Edit this to grow the rule. */
const REQUIRED_ENTRIES = ["types.ts", "ui"];

/** A module has no barrel: everything is imported from the file that defines it. */
const BARRELS = ["index.ts", "index.server.ts"];

const isTest = (entry: string) => /\.(test|spec)\.tsx?$/.test(entry);

function moduleShapeViolations(module: ModuleDir): Violation[] {
  const violations: Violation[] = [];
  const add = (snippet: string, message: string) =>
    violations.push({ file: module.name, line: 0, snippet, message });

  for (const name of REQUIRED_ENTRIES) {
    if (!module.entries.includes(name)) {
      add(`missing:${name}`, `Module "${module.name}" is missing ${name}.`);
    }
  }

  for (const kind of ["service", "models"] as const) {
    const canonical = `${module.name}.${kind}.ts`;
    // A `.ee` infix marks a file as commercial-licensed (see root LICENSE);
    // a module may keep its single service/models file under that name.
    const eeVariant = `${module.name}.ee.${kind}.ts`;
    const found = module.entries.filter((e) => e.endsWith(`.${kind}.ts`));
    if (!found.includes(canonical) && !found.includes(eeVariant)) {
      add(
        `missing:${canonical}`,
        `Module "${module.name}" must have ${canonical} (or ${eeVariant}).`
      );
    }
    for (const extra of found.filter(
      (e) => e !== canonical && e !== eeVariant
    )) {
      add(
        `extra-${kind}:${extra}`,
        `Extra ${kind} file "${extra}" — fold into ${canonical}.`
      );
    }
  }

  for (const barrel of BARRELS.filter((b) => module.entries.includes(b))) {
    add(
      `barrel:${barrel}`,
      `Module "${module.name}" has a barrel (${barrel}): import from the file that defines a thing, and let the router import ${module.name}.server.ts as a namespace.`
    );
  }

  const server = `${module.name}.server.ts`;
  const servers = [server, `${module.name}.ee.server.ts`];
  for (const extra of module.entries.filter(
    (e) =>
      /\.server\.tsx?$/.test(e) &&
      !servers.includes(e) &&
      !isTest(e) &&
      !BARRELS.includes(e)
  )) {
    add(
      `extra-server:${extra}`,
      `"${extra}": a module's only .server file is ${server}, and it holds service functions. Move its functions into ${module.name}.service.ts.`
    );
  }

  return violations;
}

export const moduleShapeCheck = defineCheck({
  id: "module-shape",
  description:
    "Each ERP module: one <name>.service.ts (or <name>.ee.service.ts), one <name>.models.ts, types.ts, ui/, at most one <name>.server.ts, and no barrel.",
  provenance: {
    deprecates:
      "scattered service/models files, module barrels (index.ts, index.server.ts), and server files besides <module>.server.ts",
    replacedBy:
      "one <module>.service.ts + one <module>.models.ts; <module>.server.ts for the service functions; imports from the defining file"
  },
  reads: { modules: erpModules },
  find: ({ modules }) => modules.flatMap(moduleShapeViolations)
});

/**
 * A module's `<module>.server.ts` (or `<module>.ee.server.ts`) is its API: every export is a
 * `defineServiceFn` const, published as `<module>_<name>` and called by routes
 * as `api.<module>.<name>(input)`. Anything else — a helper function, a class,
 * an exported constant — is a building block and lives in
 * `<module>.service.ts`. Types and plain (non-function) constants may stay.
 */
const SERVER_FILE =
  /^apps\/erp\/app\/modules\/([a-z-]+)\/\1(?:\.ee)?\.server\.ts$/;

const isDefineServiceFn = (init: Expression | null): init is CallExpression =>
  init?.type === "CallExpression" &&
  init.callee.type === "Identifier" &&
  init.callee.name === "defineServiceFn";

/** The `permission: {}` of a service function's definition, if it has one. */
const emptyPermission = (call: CallExpression) => {
  const definition = call.arguments[0];
  if (definition?.type !== "ObjectExpression") return null;
  const property = definition.properties.find(
    (p): p is ObjectProperty =>
      p.type === "Property" &&
      p.kind === "init" &&
      !p.method &&
      !p.shorthand &&
      !p.computed &&
      p.key.type === "Identifier" &&
      p.key.name === "permission"
  );
  const value = property?.value;
  return value?.type === "ObjectExpression" && value.properties.length === 0
    ? value
    : null;
};

const isFunctionValue = (init: Expression | null) =>
  init?.type === "ArrowFunctionExpression" ||
  init?.type === "FunctionExpression";

/** A binding as written, without its type annotation (`x`, `{ a, b }`). */
const bindingText = (contents: string, id: BindingPattern) =>
  id.type === "Identifier"
    ? id.name
    : contents.slice(id.start, id.typeAnnotation?.start ?? id.end).trimEnd();

// The name a finding gives a statement that declares nothing it can name. The
// check reported TypeScript's own names for these, so they are kept.
const STATEMENT_NAMES: Record<string, string> = {
  ExportNamedDeclaration: "ExportDeclaration",
  ExportAllDeclaration: "ExportDeclaration",
  ExportDefaultDeclaration: "ExportAssignment",
  TSExportAssignment: "ExportAssignment",
  TSNamespaceExportDeclaration: "NamespaceExportDeclaration",
  TSImportEqualsDeclaration: "ImportEqualsDeclaration",
  TSModuleDeclaration: "ModuleDeclaration",
  TSGlobalDeclaration: "ModuleDeclaration",
  TSDeclareFunction: "FunctionDeclaration",
  BlockStatement: "Block",
  DoWhileStatement: "DoStatement"
};

const statementName = (node: Directive | Statement) => {
  if (
    (node.type === "FunctionDeclaration" ||
      node.type === "TSDeclareFunction" ||
      node.type === "ClassDeclaration" ||
      node.type === "TSEnumDeclaration") &&
    node.id
  )
    return node.id.name;
  return STATEMENT_NAMES[node.type] ?? node.type;
};

export const serviceFnFile = defineCheck({
  files: typescript,
  id: "service-fn-file",
  description:
    "A module's <module>.server.ts exports only defineServiceFn consts; every other function lives in <module>.service.ts.",
  provenance: {
    deprecates:
      "helper functions, classes and exported values in a module's server file",
    replacedBy:
      "defineServiceFn consts in <module>.server.ts, building blocks in <module>.service.ts"
  },
  scan(file, contents) {
    const match = SERVER_FILE.exec(file);
    if (!match) return [];
    const module = match[1]!;
    const { program } = parseTypescript(file, contents);
    const violations: Violation[] = [];
    const flag = (at: number, name: string, why: string) =>
      violations.push({
        file,
        line: lineOf(contents, at),
        snippet: name,
        message: `${name}: ${why} Move it to ${module}.service.ts; ${module}.server.ts holds only service functions.`
      });

    for (const statement of program.body) {
      const { node, exported } = declarationOf(statement);
      if (
        node.type === "ImportDeclaration" ||
        node.type === "TSTypeAliasDeclaration" ||
        node.type === "TSInterfaceDeclaration"
      ) {
        continue;
      }
      if (node.type === "VariableDeclaration") {
        for (const declaration of node.declarations) {
          const name = bindingText(contents, declaration.id);
          const init = declaration.init;
          if (isDefineServiceFn(init)) {
            if (!exported) {
              flag(
                declaration.start,
                name,
                "a service function nothing can call."
              );
            }
            const empty = emptyPermission(init);
            if (empty) {
              violations.push({
                file,
                line: lineOf(contents, empty.start),
                snippet: `${name}: permission {}`,
                message: `${name}: permission {} reads as "nothing required". Write "employee" for any employee of the company.`
              });
            }
          } else if (isFunctionValue(init)) {
            flag(
              declaration.start,
              name,
              "a function, not a service function."
            );
          } else if (exported) {
            flag(
              declaration.start,
              name,
              "an export that is not a service function."
            );
          }
        }
        continue;
      }
      flag(statement.start, statementName(node), "not a service function.");
    }
    return violations;
  }
});

// ERP and MES grew the same components and hooks by copying them, so a fix
// landed in one app and not the other — the login route's lost redirect was
// copied along with the route. A file needed by both lives in a package
// (@carbon/react, @carbon/auth, @carbon/utils); each app may keep a file of
// that name that only re-exports it.
export const NO_DUPLICATED_APP_FILE = "no-duplicated-app-file";

export const SHARED_APP_DIRS = [
  "apps/erp/app/components",
  "apps/erp/app/hooks",
  "apps/mes/app/components",
  "apps/mes/app/hooks"
];

const sharedAppTypescript = (root: string) =>
  loadTypescriptFiles(root, SHARED_APP_DIRS);

// Names every folder has; they hold different things in each app.
const GENERIC = new Set(["index.ts", "index.tsx", "types.ts", "utils.ts"]);

const RE_EXPORT_ONLY =
  /^(?:\s*\/\/[^\n]*\n|\s*\n|\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["'][^"']+["'];?\s*\n?)*$/;

const appOf = (file: string) => file.split("/")[1];
const nameOf = (file: string) => file.slice(file.lastIndexOf("/") + 1);

export function findDuplicatedAppFiles(files: SourceFile[]): Violation[] {
  const byName = new Map<string, SourceFile[]>();
  for (const source of files) {
    const name = nameOf(source.file);
    if (GENERIC.has(name) || /\.test\.tsx?$/.test(name)) continue;
    if (RE_EXPORT_ONLY.test(source.contents)) continue;
    byName.set(name, [...(byName.get(name) ?? []), source]);
  }

  const violations: Violation[] = [];
  for (const [name, sources] of byName) {
    if (new Set(sources.map((s) => appOf(s.file))).size < 2) continue;
    violations.push({
      file: name,
      line: 0,
      snippet: sources.map((s) => s.file).join(" + "),
      message: `${name} exists in both apps; move it to a shared package and re-export it`
    });
  }
  return violations;
}

export const noDuplicatedAppFile = defineCheck({
  id: NO_DUPLICATED_APP_FILE,
  description:
    "A component or hook needed by both ERP and MES lives in a package; each app may keep a file of that name that only re-exports it.",
  reads: { files: sharedAppTypescript },
  find: ({ files }) => findDuplicatedAppFiles(files)
});

/**
 * Code that runs in the browser — components, hooks, stores, a module's `ui/`,
 * and the client-safe module files (`*.models.ts`, `*.utils.ts`, `types.ts`) —
 * never imports a module's `.service`, `.server` or `.pdf` file. All three are
 * server-only (a `.pdf.tsx` renders with `@react-pdf/renderer` in Node):
 * a service file may import server-only packages, and React Router refuses a
 * `.server` module in the client graph only at build time. A function the UI
 * calls lives in `<module>.utils.ts`. Type-only imports are erased and allowed.
 *
 * A route module is server AND browser code. React Router strips its loader
 * and action, so a route may import a service file for them; it fails when a
 * name it imports from one is used in the browser half (the default export,
 * `clientLoader`, components and hooks — what `maskClientCode` blanks). That
 * is how `LOCK_PERIOD_TASK_NAME` in a close-period component pulled the
 * accounting service, and its `@carbon/auth/auth.server` import, into the
 * client build, and the build failed.
 *
 * See `.claude/rules/module-files.md`.
 */
const CLIENT_FILE =
  /^apps\/erp\/app\/(?:components\/|hooks\/|stores\/|modules\/[a-z-]+\/(?:ui\/|[A-Za-z0-9.-]+\.(?:models|utils)\.tsx?$|types\.ts$))/;

const SERVER_IMPORT =
  /^(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+"([^"]+\.(?:service|server|pdf))";/gm;

const ROUTE_FILE = /^apps\/erp\/app\/routes\//;

const SERVER_IMPORT_CLAUSE =
  /^import\s+(?!type\s)([^;]*?)\s+from\s+"([^"]+\.(?:service|server|pdf))";/gm;

/** The local names a value import binds: `{ a, b as c, type T }`, `* as x`, `d`. */
function importedNames(clause: string): string[] {
  const names: string[] = [];
  const named = clause.match(/\{([^}]*)\}/);
  if (named) {
    for (const part of named[1]!.split(",")) {
      const spec = part.trim();
      if (!spec || spec.startsWith("type ")) continue;
      names.push(
        spec
          .split(/\s+as\s+/)
          .pop()!
          .trim()
      );
    }
  }
  const bare = clause
    .replace(/\{[^}]*\}/, "")
    .replace(/,/g, " ")
    .trim();
  const namespace = bare.match(/\*\s+as\s+(\w+)/);
  if (namespace) names.push(namespace[1]!);
  else if (/^\w+$/.test(bare)) names.push(bare);
  return names;
}

/** The browser half of a route, comments removed. */
function browserCode(contents: string): string {
  const masked = maskClientCode(contents).split("\n");
  return (
    contents
      .split("\n")
      .filter((line, i) => masked[i] !== line)
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
      // JSX text is prose: "Only authorize it" is not a use of `authorize`.
      .replace(/>([^<>{}()=;]*)</g, "><")
  );
}

/** `const name`, or `name` inside a destructuring: a local that shadows the import. */
const declaresLocal = (code: string, name: string) =>
  new RegExp(
    `\\b(?:const|let|var)\\s+(?:${name}\\b|[[{][^=]*\\b${name}\\b[^=]*[\\]}]\\s*=)`
  ).test(code);

/** Server-file imports a route uses in its browser half. */
function scanRoute(file: string, contents: string): Violation[] {
  const client = browserCode(contents);
  if (!client.trim()) return [];
  const violations: Violation[] = [];
  for (const match of contents.matchAll(SERVER_IMPORT_CLAUSE)) {
    for (const name of importedNames(match[1]!)) {
      if (!new RegExp(`(?<![\\w.$])${name}\\b`).test(client)) continue;
      if (declaresLocal(client, name)) continue;
      violations.push({
        file,
        line: lineOf(contents, match.index),
        snippet: `${name} from ${match[2]!}`,
        message: `"${name}" from "${match[2]}" is used in the route's browser code, which pulls the server-only file into the client build: move it into the module's .utils.ts, or pass it from the loader.`
      });
    }
  }
  return violations;
}

export const noServerCodeInClient = defineCheck({
  files: typescript,
  id: "no-server-code-in-client",
  description:
    "Components, hooks, ui/, models, utils, types and a route's browser code never import a .service or .server file.",
  provenance: {
    deprecates:
      "a browser-side file importing a module's service or server file",
    replacedBy:
      "the client-safe function in <module>.utils.ts, or data from the route's loader"
  },
  scan(file, contents) {
    if (ROUTE_FILE.test(file)) return scanRoute(file, contents);
    if (!CLIENT_FILE.test(file)) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(SERVER_IMPORT)) {
      violations.push({
        file,
        line: lineOf(contents, match.index),
        snippet: match[1]!,
        message: `"${match[1]}" is server-only: move what this file calls into the module's .utils.ts, or pass it from the route's loader.`
      });
    }
    return violations;
  }
});

// A bare import (`import "./x"`) runs a file for what it does, not for what it
// exports. In a package whose package.json says `"sideEffects": false`, or
// lists only some files, the production bundler drops a bare import of any file
// it does not list: `import "./modules/carbon.server"` vanished from the ERP's
// server bundle, so every `carbon()` call threw "the app has not called
// registerCarbon", and `z.config({ jitless: true })` never ran in either app.
// Typecheck, tests and the dev server (which does not tree-shake) cannot see it.
//
// Only a bare import of a file in the importer's own package is checked
// (`./x`, `../x`, `~/x`). A bare import of another package is left to that
// package's own `sideEffects`. A `.css` import is ignored.
export const SIDE_EFFECT_IMPORT_DECLARED = "side-effect-import-declared";

export type SideEffectPackage = {
  /** Repo-relative package directory, e.g. `apps/erp`. */
  dir: string;
  /** The package.json `sideEffects` value: `false` or a list of files. */
  sideEffects: false | string[];
  /** Every file under the package that exists, repo-relative. */
  paths: Set<string>;
  files: SourceFile[];
};

const BARE_IMPORT = /^import\s+["']([^"']+)["'];?\s*$/gm;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

const toRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/^\.\//, "")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\/?/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*")}$`
  );

/** Whether a package-relative file is listed by `sideEffects` (webpack's rules). */
export function declaresSideEffects(
  sideEffects: false | string[],
  file: string
): boolean {
  if (sideEffects === false) return false;
  return sideEffects.some((pattern) =>
    toRegExp(pattern).test(
      pattern.replace(/^\.\//, "").includes("/")
        ? file
        : file.slice(file.lastIndexOf("/") + 1)
    )
  );
}

function resolve(pkg: SideEffectPackage, from: string, spec: string) {
  let base: string;
  if (spec.startsWith("~/")) base = `${pkg.dir}/app/${spec.slice(2)}`;
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const parts = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    base = parts.join("/");
  } else return null; // another package: its own sideEffects decide
  for (const ext of EXTENSIONS) {
    if (pkg.paths.has(base + ext)) return base + ext;
  }
  return null;
}

export function findUndeclaredSideEffectImports(
  packages: SideEffectPackage[]
): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of packages) {
    for (const { file, contents } of pkg.files) {
      for (const match of contents.matchAll(BARE_IMPORT)) {
        const spec = match[1]!;
        if (spec.endsWith(".css")) continue;
        const target = resolve(pkg, file, spec);
        if (!target) continue;
        const relative = target.slice(pkg.dir.length + 1);
        if (declaresSideEffects(pkg.sideEffects, relative)) continue;
        violations.push({
          file,
          line: lineOf(contents, match.index),
          snippet: spec,
          message: `"${spec}" is imported for its side effects, but ${pkg.dir}/package.json does not list "./${relative}" in "sideEffects", so the production build drops it. Add it there.`
        });
      }
    }
  }
  return violations;
}

export const sideEffectImportDeclared = defineCheck({
  id: SIDE_EFFECT_IMPORT_DECLARED,
  description:
    'In a package whose package.json says `"sideEffects": false`, or lists only some files, the production bundler drops a bare import of any file it does not list.',
  reads: { packages: loadSideEffectPackages },
  find: ({ packages }) => findUndeclaredSideEffectImports(packages)
});

/** The modules checks, in the order they are written above. */
export const checks: Check[] = [
  moduleShapeCheck,
  serviceFnFile,
  noDuplicatedAppFile,
  noServerCodeInClient,
  sideEffectImportDeclared
];
