// Stable string keys for persisted state (implementationCheckState.itemKey /
// implementationFieldValue.fieldKey). Baked into content templates so adding or
// reordering template nodes never reassigns a saved key.

export const gateKey = (slug: string) => `gate:${slug}`;
export const productStepKey = (slug: string) => `prod:${slug}`;
export const taskKey = (boardKey: string) => `task:${boardKey}`;
export const flagKey = (reqCode: string) => `flag:${reqCode}`;
export const checkKey = (page: string, n: number | string) =>
  `check:${page}.${n}`;
export const fmtKey = (trackRow: string) => `fmt:${trackRow}`;
export const fieldTextKey = (fieldKey: string) => `txt:${fieldKey}`;

// DOM anchor id for a spine step's card in the Plan view. Colons aren't valid in
// a URL fragment target lookup, so swap them for hyphens (gate:configure → gate-configure).
export const planAnchorId = (stepKey: string) =>
  `plan-${stepKey.replace(/:/g, "-")}`;
