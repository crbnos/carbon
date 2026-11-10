// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Action, type Level, lowerLevel } from "./levels";
import * as accounting from "./pages/accounting";
import * as documents from "./pages/documents";
import * as inventory from "./pages/inventory";
import * as invoicing from "./pages/invoicing";
import * as parts from "./pages/parts";
import * as people from "./pages/people";
import * as production from "./pages/production";
import * as projects from "./pages/projects";
import * as purchasing from "./pages/purchasing";
import * as quality from "./pages/quality";
import * as resources from "./pages/resources";
import * as sales from "./pages/sales";
import * as service from "./pages/service";
import * as settings from "./pages/settings";
import * as users from "./pages/users";
import * as workflows from "./pages/workflows";

/**
 * Two or more pages share a table: the column and value that pick this page's
 * rows. Without a value, the page's rows are the ones where the column is set
 * (a memo's `supplierId`, a grant's `apiKeyId`).
 */
export type SharedTable = {
  table: string;
  column: string;
  value?: string | boolean;
};

/** `[fk, table]`: the next table's row whose `id` is this row's `fk`. */
export type Hop = readonly [fk: string, table: string];

/**
 * A table that hangs off a shared table. `via` is the column that points at
 * the shared row; `path` is the hops to it through other tables, ending at the
 * shared table (`methodMaterial` → `makeMethod` → `item`).
 */
export type Child =
  | { table: string; via: string }
  | { table: string; path: readonly Hop[] };

/** A permission subject: a screen, usually one sidebar entry (`use<Module>Submodules.tsx`). */
export type Page = {
  /** `<module>.<page>`, or the module key for a module that has one page. */
  id: string;
  label: string;
  /** The highest level the page supports. */
  maxLevel: Level;
  /** The tables the page owns: writes to them need the page's levels. */
  tables: readonly string[];
  where?: SharedTable;
  /** Tables of the shared table's pages that check `where` through it. */
  children?: readonly Child[];
  /** Restricted tables of other modules' pages that this page reads. */
  readers?: readonly string[];
  /**
   * Tables this page owns that other pages also write, each with those pages:
   * a table that moved to this page from another module keeps the page that
   * wrote it before (20261110101723_grants-for-moved-tables.sql gives the
   * moved tables it does not list a grant instead). RLS renders it.
   */
  alsoWrittenBy?: Readonly<Record<string, readonly string[]>>;
  /** Route path prefixes, used to map route files to pages. */
  paths: readonly string[];
};

/** The page files, one per permission module, in sidebar order. */
const MODULE_FILES = [
  accounting,
  documents,
  inventory,
  invoicing,
  parts,
  people,
  production,
  projects,
  purchasing,
  quality,
  resources,
  sales,
  service,
  settings,
  users,
  workflows
] as const satisfies readonly { LABEL: string; PAGES: readonly Page[] }[];

type RegistryPage = (typeof MODULE_FILES)[number]["PAGES"][number];

/** Every page, module by module in sidebar order. */
export const PAGES: readonly RegistryPage[] = MODULE_FILES.flatMap(
  (file) => file.PAGES as readonly RegistryPage[]
);

export type PageId = (typeof PAGES)[number]["id"];
export type PermissionKey = `${PageId}_${Action}`;

/** A permission module's id: a page id up to its first `.` (`inventory`, `documents`). */
export type ModuleId = PageId extends infer P
  ? P extends `${infer M}.${string}`
    ? M
    : P
  : never;

/** The `module` enum label of a permission module: `Inventory`, and `Parts` for Items. */
export type ModuleEnum = Capitalize<ModuleId>;

/** The permission modules, in sidebar order: `label` is the sidebar name, `enum` the `module` enum label. */
export const MODULES: readonly {
  id: ModuleId;
  label: string;
  enum: ModuleEnum;
}[] = MODULE_FILES.map((file) => {
  const id = moduleOf(file.PAGES[0].id) as ModuleId;
  return { id, label: file.LABEL, enum: moduleEnum(id) };
});

const MODULE_IDS = new Set<string>(
  MODULE_FILES.map((file) => moduleOf(file.PAGES[0].id))
);

const PAGE_BY_ID = new Map<string, Page>(PAGES.map((page) => [page.id, page]));

export function pageById(pageId: string): Page | undefined {
  return PAGE_BY_ID.get(pageId);
}

export function moduleOf(pageId: string): string {
  const dot = pageId.indexOf(".");
  return dot === -1 ? pageId : pageId.slice(0, dot);
}

/** The `module` enum label of a module id: `inventory` → `Inventory`. */
export function moduleEnum(id: ModuleId): ModuleEnum {
  return (id.charAt(0).toUpperCase() + id.slice(1)) as ModuleEnum;
}

/** The module id of a `module` enum label; undefined for a label with no pages (`Items`). */
export function moduleId(label: string): ModuleId | undefined {
  const id = label.charAt(0).toLowerCase() + label.slice(1);
  return MODULE_IDS.has(id) && moduleEnum(id as ModuleId) === label
    ? (id as ModuleId)
    : undefined;
}

/** Whether a `module` enum label names a module with pages: a grant can hold it. */
export function isPageModule(label: string): label is ModuleEnum {
  return moduleId(label) !== undefined;
}

/** The pages of a module, in sidebar order. */
export function pagesOf(module: string): PageId[] {
  return PAGES.filter((page) => moduleOf(page.id) === module).map(
    (page) => page.id
  );
}

/** The page of each item type, which picks its rows of `item`: `{ Part: "parts.parts", … }`. */
export const ITEM_TYPE_PAGES: Readonly<Record<string, PageId>> =
  Object.fromEntries(
    PAGES.flatMap((page) =>
      "where" in page && page.where.table === "item"
        ? [[page.where.value, page.id]]
        : []
    )
  );

/** The five item type pages: Parts, Materials, Tools, Consumables and Services. */
export const ITEM_PAGES: readonly PageId[] = Object.values(ITEM_TYPE_PAGES);

/** One page's rows of a shared table: the column, and the value that picks them. */
export type Branch = {
  page: string;
  column: string;
  value?: string | boolean;
};

/**
 * Where a table sits in the registry, which decides what a module key in its
 * RLS rule resolves to: the page that owns it, one branch per page of a shared
 * table, or the branches of the shared table it hangs off.
 */
export type TablePlace =
  | { kind: "page"; page: string }
  | { kind: "shared"; branches: Branch[] }
  | { kind: "child"; parent: string; path: readonly Hop[]; branches: Branch[] };

/** A child's hops to its shared table: `via` is a path of one hop. */
export const childPath = (child: Child, parent: string): readonly Hop[] =>
  "path" in child ? child.path : [[child.via, parent]];

function buildIndex() {
  const places = new Map<string, TablePlace>();
  const readers = new Map<string, string[]>();
  const put = (table: string, next: TablePlace) => {
    const prev = places.get(table);
    if (!prev) {
      places.set(table, next);
      return;
    }
    if (
      prev.kind === "page" ||
      next.kind === "page" ||
      prev.kind !== next.kind ||
      (prev.kind === "child" &&
        next.kind === "child" &&
        (prev.parent !== next.parent ||
          JSON.stringify(prev.path) !== JSON.stringify(next.path)))
    )
      throw new Error(`registry: ${table} sits on more than one page`);
    prev.branches.push(...next.branches);
  };
  for (const page of PAGES as readonly Page[]) {
    const where = page.where;
    const branch = where && {
      page: page.id,
      column: where.column,
      value: where.value
    };
    for (const table of page.tables)
      put(
        table,
        branch && where?.table === table
          ? { kind: "shared", branches: [branch] }
          : { kind: "page", page: page.id }
      );
    for (const child of page.children ?? []) {
      if (!branch || !where)
        throw new Error(`registry: ${page.id} has children but no where`);
      put(child.table, {
        kind: "child",
        parent: where.table,
        path: childPath(child, where.table),
        branches: [branch]
      });
    }
    for (const table of page.readers ?? [])
      readers.set(table, [...(readers.get(table) ?? []), page.id]);
  }
  return { places, readers };
}

const INDEX = buildIndex();

/** The table's place in the registry; undefined when no page lists it. */
export function placeOf(table: string): TablePlace | undefined {
  return INDEX.places.get(table);
}

/** The pages that list the table in `readers`. */
export function readersOf(table: string): readonly string[] {
  return INDEX.readers.get(table) ?? [];
}

/**
 * The pages whose View admits a read of what a page owns: every page of its
 * module, then the pages of other modules that list one of its tables in
 * `readers`. Writes stay per page. RLS (`render`) and `holdsGate`'s read
 * mode (`widenReads`) both use it.
 */
export function readPages(pageId: string): PageId[] {
  const module = moduleOf(pageId);
  const others = new Set<string>();
  for (const table of pageById(pageId)?.tables ?? [])
    for (const reader of readersOf(table))
      if (moduleOf(reader) !== module) others.add(reader);
  return [
    ...pagesOf(module),
    ...(PAGES as readonly Page[])
      .map((page) => page.id as PageId)
      .filter((id) => others.has(id))
  ];
}

/** A level at most the page's `maxLevel`; an unknown page leaves it as it is. */
export function clampLevel(pageId: string, level: Level): Level {
  const page = PAGE_BY_ID.get(pageId);
  return page ? lowerLevel(level, page.maxLevel) : level;
}

const segments = (path: string) => path.split("/").filter(Boolean);

/**
 * How many segments of a page path cover the URL; 0 when it does not. A path
 * covers its own URL and every URL below it. A `$param` segment of the path
 * matches any one segment, so a pathname (`/x/customer/c1/assets`) and a route
 * pattern (`/x/customer/$customerId/assets`) both match.
 */
function coverage(path: string, url: readonly string[]): number {
  const want = segments(path);
  if (want.length > url.length) return 0;
  for (const [i, part] of want.entries())
    if (!part.startsWith("$") && part !== url[i]) return 0;
  return want.length;
}

/**
 * The page a URL belongs to: the page with the longest `paths` entry that
 * covers it. Undefined for a URL no page covers (the dashboard, a settings
 * index, a route listed in the registry test's `UNPAGED_ROUTES`).
 */
export function pageOfUrl(pathname: string): PageId | undefined {
  const url = segments(pathname.split(/[?#]/)[0] ?? "");
  let best: { page: PageId; length: number } | undefined;
  for (const page of PAGES)
    for (const path of page.paths) {
      const length = coverage(path, url);
      if (length > (best?.length ?? 0)) best = { page: page.id, length };
    }
  return best?.page;
}

/**
 * The page that owns a row of `table`: the page that owns the table, or for a
 * table several pages share, the page whose `where` the row matches (an item
 * by its `type`, a memo by which party it carries, a run by its `type`). The
 * row needs the `where` column. Undefined for a table no page owns, a shared
 * row no `where` matches, and a child table (its row does not carry the
 * shared column: ask about the shared row it hangs off).
 */
export function pageOfRow(
  table: string,
  row: Readonly<Record<string, unknown>>
): PageId | undefined {
  const place = placeOf(table);
  if (place?.kind === "page") return place.page as PageId;
  if (place?.kind !== "shared") return undefined;
  const branch = place.branches.find(({ column, value }) => {
    const cell = row[column];
    if (cell === null || cell === undefined) return false;
    return value === undefined || String(cell) === String(value);
  });
  return branch?.page as PageId | undefined;
}

// FNV-1a, not node:crypto: the claims cache key is built in browser code too.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Part of the claims cache key. Cached claims hold a level per page id, at
 * most its `maxLevel`, so only those retire them: a label or path edit does not.
 */
export const REGISTRY_HASH = fnv1a(
  JSON.stringify(PAGES.map((page) => [page.id, page.maxLevel]))
);
