// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { posix } from "node:path";
import type { ConformanceCheck, SourceFile, Violation } from "../check";

// React Router keeps a route's components mounted when only its params change
// (part A to part B, one order line to the next). Whatever the page seeded once
// from its record — a form's default values, an editor's initial content, a
// `useState` copy — then belongs to the previous record: a notes editor showed
// record A's notes on record B and the first keystroke saved them there.
// `RecordOutlet` remounts the page when it is shown for a different record.
const ROUTES = /^apps\/(?:erp|mes)\/app\/routes\/x\+\//;
const OUTLET = /<Outlet(?=[\s/>])([^>]*)>/g;

export const noBareOutlet: ConformanceCheck = {
  id: "no-bare-outlet",
  description:
    "a route under /x renders RecordOutlet, which remounts its page when the record changes",
  provenance: {
    deprecates: "<Outlet />",
    replacedBy: '<RecordOutlet /> from "@carbon/react"',
    since: "2026-10-06",
    incidents: ["f18c5dad02", "5a0ea7c0d2"]
  },
  scan(file: string, contents: string): Violation[] {
    if (!ROUTES.test(file)) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(OUTLET)) {
      // An outlet with its own key already says when its page remounts (the
      // shell keys on the company).
      if (/\bkey=/.test(match[1]!)) continue;
      const line = contents.slice(0, match.index).split("\n").length;
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
};

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
