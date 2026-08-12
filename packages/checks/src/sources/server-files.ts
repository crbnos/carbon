import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SqlFile } from "./migrations";

/**
 * Server-side TypeScript that must derive calendar days through the `datetime`
 * API (explicit company/location timezone), never the process clock. Client
 * components are exempt — the browser's timezone IS the right one there.
 */
const SERVER_ROOTS = [
  "apps/mes/app/services",
  "packages/jobs/src",
  "packages/database/supabase/functions"
];

/** ERP module server files are matched by suffix inside apps/erp/app/modules. */
const ERP_MODULES_ROOT = "apps/erp/app/modules";
const ERP_SERVER_SUFFIXES = [".service.ts", ".server.ts"];

/**
 * Route modules are server AND client in one file: `loader`/`action` run on the
 * server, while the default export and `clientLoader`/`clientAction` run in the
 * browser. Scanning them whole would flag every legitimate browser-side
 * `getLocalTimeZone()`, so route files are masked down to their server
 * functions before the checks see them.
 */
const ROUTE_ROOTS = ["apps/erp/app/routes", "apps/mes/app/routes"];

/**
 * Opens a browser-only region. Masking *out* these rather than masking *in*
 * `loader`/`action` is deliberate: module-level helpers that the loader calls
 * (e.g. `getExpiredItemIds` in job+/$jobId.materials.tsx) are server code too,
 * and a mask-in rule would silently skip them.
 */
const CLIENT_REGION_START = [
  /^export\s+default\s+(?:async\s+)?function\b/,
  /^export\s+default\s+(?:memo|forwardRef)\b/,
  // clientLoader/clientAction run in the browser, unlike loader/action.
  /^export\s+(?:async\s+function\s+|function\s+|const\s+)client(?:Loader|Action)\b/,
  // Components and hooks: PascalCase or use-prefixed declarations.
  /^(?:export\s+)?(?:async\s+)?function\s+(?:[A-Z]|use[A-Z])/,
  /^(?:export\s+)?const\s+(?:[A-Z]|use[A-Z])[A-Za-z0-9_]*\s*(?::[^=]*)?=\s*(?:\(|function|memo|forwardRef)/
];

function walk(dir: string, out: string[], extensions: string[]): void {
  // A missing root (e.g. a partial checkout) yields no findings for it rather
  // than aborting the whole scan.
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out, extensions);
    } else if (
      extensions.some((ext) => entry.endsWith(ext)) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(path);
    }
  }
}

const netCount = (line: string, open: string, close: string): number =>
  line.split(open).length - line.split(close).length;

/**
 * A declaration that begins AND ends on one line (`const Toolbar = () => null;`)
 * opens no block, so it must not open a region — otherwise everything after it
 * (including a later `loader`) would be masked until a column-0 closer that
 * never comes.
 */
const isSingleLineDeclaration = (line: string): boolean =>
  line.trimEnd().endsWith(";") &&
  netCount(line, "{", "}") <= 0 &&
  netCount(line, "(", ")") <= 0;

/**
 * Blanks every component/hook/clientLoader/clientAction body, leaving the
 * server half of a route module. Line numbering is preserved so violations
 * still point at the real line. A region runs from its declaration to the next
 * column-0 `}` or `)` (`}` for block bodies, `)` for paren-wrapped
 * expression-bodied arrows) — reliable because the repo is Biome-formatted, so
 * a top-level closer is never indented.
 */
export function maskClientCode(contents: string): string {
  const lines = contents.split("\n");
  const kept = [...lines];
  let inClientRegion = false;

  lines.forEach((line, i) => {
    if (!inClientRegion && CLIENT_REGION_START.some((re) => re.test(line))) {
      if (isSingleLineDeclaration(line)) {
        kept[i] = "";
        return;
      }
      inClientRegion = true;
    }
    if (inClientRegion) {
      kept[i] = "";
      // `}`/`};` closes a block body; a bare `)`/`);` closes a paren-wrapped
      // expression body. A `) {`-style line is a multi-line SIGNATURE closer —
      // the body is still ahead, so it must not end the region.
      if (line.startsWith("}") || /^\)\s*;?\s*$/.test(line)) {
        inClientRegion = false;
      }
    }
  });

  return kept.join("\n");
}

/** Every server-side TS file, as repo-relative { file, contents }. */
export function loadServerFiles(root: string): SqlFile[] {
  const paths: string[] = [];

  for (const rel of SERVER_ROOTS) {
    walk(join(root, rel), paths, [".ts"]);
  }

  const erpPaths: string[] = [];
  walk(join(root, ERP_MODULES_ROOT), erpPaths, [".ts"]);
  for (const path of erpPaths) {
    if (ERP_SERVER_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
      paths.push(path);
    }
  }

  const routePaths: string[] = [];
  for (const rel of ROUTE_ROOTS) {
    walk(join(root, rel), routePaths, [".ts", ".tsx"]);
  }
  paths.push(...routePaths);
  const isRoute = new Set(routePaths);

  return paths
    .map((path) => ({ path, file: relative(root, path) }))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(({ path, file }) => {
      const contents = readFileSync(path, "utf8");
      return {
        file,
        contents: isRoute.has(path) ? maskClientCode(contents) : contents
      };
    });
}
