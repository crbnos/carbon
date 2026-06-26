import type { HubExclusions, Mod, PageDef, Tier } from "../types";

// Server-side visibility filter (mirrors the prototype's client exclusion engine,
// moved to the backend so "exclude Accounting" is real and shared). A node is
// hidden only when EVERY one of its module tags is excluded.
export function isModuleExcluded(
  tags: Mod[] | undefined,
  excludedModules: Mod[]
): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.every((t) => excludedModules.includes(t));
}

// Drop every node whose module tags are all excluded. Centralizes the
// `items.filter(i => !isModuleExcluded(i.moduleTags, ...))` that the Setup,
// Data, Requirements, and Scope views each re-implemented inline.
export function filterByModule<T extends { moduleTags?: Mod[] }>(
  items: T[],
  excludedModules: Mod[]
): T[] {
  return items.filter((i) => !isModuleExcluded(i.moduleTags, excludedModules));
}

export function isPageVisible(
  page: PageDef,
  exclusions: HubExclusions,
  isInternal: boolean,
  tier?: Tier
): boolean {
  if (page.carbonOnly && !isInternal) return false;
  if (page.tiers && tier && !page.tiers.includes(tier)) return false;
  if (exclusions.pages.includes(page.slug)) return false;
  if (isModuleExcluded(page.moduleTags, exclusions.modules)) return false;
  return true;
}

export function isSectionVisible(
  sectionKey: string,
  exclusions: HubExclusions
): boolean {
  return !exclusions.sections.includes(sectionKey);
}

export const EMPTY_EXCLUSIONS: HubExclusions = {
  modules: [],
  pages: [],
  sections: []
};
