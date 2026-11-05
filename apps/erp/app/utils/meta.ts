// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { resolveLanguage } from "@carbon/locale";
import { type I18n, type Messages, setupI18n } from "@lingui/core";
import type { MetaFunction } from "react-router";
import { getCatalog } from "~/services/lingui";

/**
 * Document title for a record page, e.g. "SO000001 | Sales Order | Carbon",
 * so the browser tab (and anything reading the page) names the open record.
 * Falls back to "Carbon | Sales Order" while the record is missing (loader
 * error, redirect, not yet loaded). Safe to call from `meta` — never throws.
 */
export function recordMeta(
  recordId: string | null | undefined,
  recordType: string
) {
  const id = typeof recordId === "string" ? recordId.trim() : "";
  return [
    { title: id ? `${id} | ${recordType} | Carbon` : `Carbon | ${recordType}` }
  ];
}

// One Lingui runtime per language: `meta` runs outside React, so it cannot use
// the `LocaleProvider` runtime, but it reads the same catalog. Keyed by
// language, not catalog: `getCatalog` hands back a fresh `{}` while a newly
// chosen language is still loading, which would miss a catalog-keyed cache on
// every call. The runtime is reloaded once the real catalog arrives.
const runtimes = new Map<string, { catalog: Messages; i18n: I18n }>();

const hasMessages = (catalog: Messages) => Object.keys(catalog).length > 0;

export function getRuntime(locale: unknown): I18n {
  const language = resolveLanguage(typeof locale === "string" ? locale : null);
  return runtimeFor(language, getCatalog(language), runtimes);
}

/**
 * The runtime for `language`, given what its catalog holds right now. Pure
 * apart from the `runtimes` cache it is handed, so it is tested by value.
 */
export function runtimeFor(
  language: string,
  catalog: Messages,
  runtimes: Map<string, { catalog: Messages; i18n: I18n }>
): I18n {
  const cached = runtimes.get(language);
  if (cached) {
    if (cached.catalog !== catalog && hasMessages(catalog)) {
      cached.i18n.load(language, catalog);
      cached.i18n.activate(language);
      cached.catalog = catalog;
    }
    if (hasMessages(cached.catalog)) return cached.i18n;
  }
  if (!hasMessages(catalog)) {
    // The chosen language is still loading: a runtime with messages in the
    // previous language reads better than hashed message ids in the title.
    for (const entry of runtimes.values()) {
      if (hasMessages(entry.catalog)) return entry.i18n;
    }
  }
  if (cached) return cached.i18n;
  const i18n = setupI18n();
  i18n.load(language, catalog);
  i18n.activate(language);
  runtimes.set(language, { catalog, i18n });
  return i18n;
}

type MetaMatchLike = {
  id: string;
  params: unknown;
  data?: unknown;
  loaderData?: unknown;
  handle?: unknown;
};

// The breadcrumb labels of the matched routes, outermost first, as text —
// the same trail the Topbar `Breadcrumbs` renders (`useBreadcrumbs`).
function breadcrumbTrail(matches: MetaMatchLike[]): string[] {
  const root = matches.find((m) => m.id === "root");
  const locale = (
    (root?.loaderData ?? root?.data) as
      | { preferences?: { locale?: unknown } }
      | undefined
  )?.preferences?.locale;
  let i18n: I18n | undefined;

  const toText = (value: unknown): string | undefined => {
    if (typeof value === "string") return value.trim() || undefined;
    if (typeof value === "number") return String(value);
    if (typeof value === "object" && value !== null && "id" in value) {
      i18n ??= getRuntime(locale);
      const text = i18n._(value as { id: string; message?: string });
      return text.trim() || undefined;
    }
    // JSX and other non-text labels have no title form.
    return undefined;
  };

  return matches.flatMap((m) => {
    const handle = m.handle as { breadcrumb?: unknown } | undefined;
    if (!handle?.breadcrumb) return [];
    let resolved: unknown;
    try {
      resolved =
        typeof handle.breadcrumb === "function"
          ? handle.breadcrumb(m.params, m.loaderData ?? m.data)
          : handle.breadcrumb;
    } catch {
      return [];
    }
    const labels = Array.isArray(resolved)
      ? resolved.map((seg) =>
          seg && typeof seg === "object" && "breadcrumb" in seg
            ? seg.breadcrumb
            : undefined
        )
      : [resolved];
    return labels
      .map(toText)
      .filter((label): label is string => label !== undefined);
  });
}

// The breadcrumb trail deepest first, without consecutive duplicates
// ("Sales" layout + "Sales" index say nothing new). Never throws.
function titleLabels(matches: MetaMatchLike[]): string[] {
  let trail: string[] = [];
  try {
    trail = breadcrumbTrail(matches);
  } catch {
    trail = [];
  }
  return trail
    .reverse()
    .filter((label, i, all) => i === 0 || label !== all[i - 1]);
}

function breadcrumbTitle(matches: MetaMatchLike[], moduleTitle: string) {
  const labels = titleLabels(matches);
  return labels.length
    ? `${labels.join(" | ")} | Carbon`
    : `Carbon | ${moduleTitle}`;
}

/**
 * `meta` for a module layout. Names the page from the breadcrumb trail,
 * deepest first — "Orders | Sales | Carbon", "Company | Settings | Carbon" —
 * so every list and settings page has its own title, not just the module's.
 * Falls back to "Carbon | <moduleTitle>" when no route has a breadcrumb.
 * A record route's own `meta` (`recordMeta`) is deeper, so it still wins.
 *
 * React Router calls a layout's `meta` with only the matches up to the
 * layout, so the child page's breadcrumb is not there yet. It fills the same
 * `matches` array with the deeper matches before `<Meta />` renders, and
 * renders the title with `String(title)` — so the title is computed on render,
 * from every match. A child without its own `meta` reuses this descriptor.
 */
export function moduleMeta(moduleTitle: string): MetaFunction {
  return ({ matches }) => {
    const title = {
      toString: () => breadcrumbTitle(matches as MetaMatchLike[], moduleTitle)
    };
    return [{ title: title as unknown as string }];
  };
}

/**
 * `meta` for a "new record" page, e.g. "New Sales Order | Sales | Carbon".
 * Pass the record name from the page's heading ("New Sales Order"). The
 * trail is the parent routes' breadcrumbs: the page's own breadcrumb names
 * the list it creates into ("Orders"), not the page.
 */
export function newRecordMeta(recordType: string): MetaFunction {
  return ({ matches }) => {
    // A leaf route's `meta` gets every match up to itself, itself last.
    const labels = titleLabels((matches as MetaMatchLike[]).slice(0, -1));
    return [{ title: [`New ${recordType}`, ...labels, "Carbon"].join(" | ") }];
  };
}
