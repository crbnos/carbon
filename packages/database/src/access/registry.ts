// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Action, type Level, lowerLevel } from "./levels";
import { ACCOUNTING_PAGES } from "./pages/accounting";
import { DOCUMENTS_PAGES } from "./pages/documents";
import { INVENTORY_PAGES } from "./pages/inventory";
import { INVOICING_PAGES } from "./pages/invoicing";
import { PARTS_PAGES } from "./pages/parts";
import { PEOPLE_PAGES } from "./pages/people";
import { PRODUCTION_PAGES } from "./pages/production";
import { PURCHASING_PAGES } from "./pages/purchasing";
import { QUALITY_PAGES } from "./pages/quality";
import { RESOURCES_PAGES } from "./pages/resources";
import { SALES_PAGES } from "./pages/sales";
import { SETTINGS_PAGES } from "./pages/settings";
import { USERS_PAGES } from "./pages/users";
import { WORKFLOWS_PAGES } from "./pages/workflows";

/**
 * Two or more pages share a table: the column and value that pick this page's
 * rows. Without a value, the page's rows are the ones where the column is set
 * (a memo's `supplierId`, a grant's `apiKeyId`).
 */
export type SharedTable = { table: string; column: string; value?: string };

/** A permission subject: one sidebar entry (`use<Module>Submodules.tsx`). */
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
  children?: readonly { table: string; via: string }[];
  /** Restricted tables of other pages that this page reads. */
  readers?: readonly string[];
  /** Route path prefixes, used to map route files to pages. */
  paths: readonly string[];
};

/** The permission modules, in sidebar order. Items keeps its permission name, `parts`. */
export const MODULES: readonly { id: string; label: string }[] = [
  { id: "accounting", label: "Accounting" },
  { id: "documents", label: "Documents" },
  { id: "inventory", label: "Inventory" },
  { id: "invoicing", label: "Invoicing" },
  { id: "parts", label: "Items" },
  { id: "people", label: "People" },
  { id: "production", label: "Production" },
  { id: "purchasing", label: "Purchasing" },
  { id: "quality", label: "Quality" },
  { id: "resources", label: "Resources" },
  { id: "sales", label: "Sales" },
  { id: "settings", label: "Settings" },
  { id: "users", label: "Users" },
  { id: "workflows", label: "Workflows" }
];

/** Every page, module by module in sidebar order. */
export const PAGES = [
  ...ACCOUNTING_PAGES,
  ...DOCUMENTS_PAGES,
  ...INVENTORY_PAGES,
  ...INVOICING_PAGES,
  ...PARTS_PAGES,
  ...PEOPLE_PAGES,
  ...PRODUCTION_PAGES,
  ...PURCHASING_PAGES,
  ...QUALITY_PAGES,
  ...RESOURCES_PAGES,
  ...SALES_PAGES,
  ...SETTINGS_PAGES,
  ...USERS_PAGES,
  ...WORKFLOWS_PAGES
] as const satisfies readonly Page[];

export type PageId = (typeof PAGES)[number]["id"];
export type PermissionKey = `${PageId}_${Action}`;

const PAGE_BY_ID = new Map<string, Page>(PAGES.map((page) => [page.id, page]));

export function pageById(pageId: string): Page | undefined {
  return PAGE_BY_ID.get(pageId);
}

/** The module a page belongs to: the text before the first `.`. */
export function moduleOf(pageId: string): string {
  const dot = pageId.indexOf(".");
  return dot === -1 ? pageId : pageId.slice(0, dot);
}

/** A level at most the page's `maxLevel`. Grant writers call it; the resolver does not. */
export function clampLevel(pageId: string, level: Level): Level {
  const page = PAGE_BY_ID.get(pageId);
  return page ? lowerLevel(level, page.maxLevel) : level;
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

/** Changes whenever the registry changes; part of the claims cache key. */
export const REGISTRY_HASH = fnv1a(JSON.stringify(PAGES));
