// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Action, type Level, lowerLevel } from "./levels";

/** Two or more pages share a table: the column and value that pick this page's rows. */
export type SharedTable = { table: string; column: string; value: string };

/** A permission subject: one sidebar entry, or a whole module until it is split. */
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

const modulePage = (id: string, label: string) =>
  ({
    id,
    label,
    maxLevel: "Full",
    tables: [],
    paths: [`/x/${id}`]
  }) as const satisfies Page;

/** Every page. Until a module is split, it has one page named after it. */
export const PAGES = [
  modulePage("accounting", "Accounting"),
  modulePage("documents", "Documents"),
  modulePage("inventory", "Inventory"),
  modulePage("invoicing", "Invoicing"),
  modulePage("parts", "Items"),
  modulePage("people", "People"),
  modulePage("printing", "Printing"),
  modulePage("production", "Production"),
  modulePage("purchasing", "Purchasing"),
  modulePage("quality", "Quality"),
  modulePage("resources", "Resources"),
  modulePage("sales", "Sales"),
  modulePage("settings", "Settings"),
  modulePage("users", "Users"),
  modulePage("workflows", "Workflows")
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
