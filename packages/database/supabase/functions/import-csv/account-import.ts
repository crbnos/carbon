// Chart-of-accounts import: the pure planner. The writer that applies a plan
// lives in account-import-writer.ts so this module (and its tests) stay free of
// database imports.
//
// The planner turns mapped CSV rows and the company group's existing chart into
// an ImportPlan — one node per source row (plus one per synthesized group), each
// with an action and, for refusals, a reason. The same plan is returned to the
// wizard for review (dryRun) and applied by `applyAccountPlan` on commit, so what
// the user reviews is exactly what gets written.
//
// Why accounts need their own planner rather than `classifyImportRow`:
//   - `account` is scoped by companyGroupId, and its natural keys are `number`
//     for leaves and `(name, isGroup)` for groups (`account_number_key`,
//     `account_name_key`).
//   - The chart is a tree. Parents arrive as a number, a "number name" string, a
//     group name, a grouping label that is not an account, a colon-delimited
//     path inside the name (QuickBooks), or Begin-Total / End-Total rows
//     (Business Central, Sage 50 Canada). Nothing in the DB guards
//     parent-is-group, class agreement with the parent, or cycles, so the
//     planner does.
//   - `class` / `incomeBalance` / `consolidatedRate` are derived, never mapped.
//   - The two isSystem roots are frozen by trigger and must only ever be adopted
//     as parents.
//
// Spec: .ai/specs/2026-09-04-chart-of-accounts-import.md

// ---------------------------------------------------------------------------
// Carbon's vocabulary (mirrors apps/erp/app/modules/accounting/accounting.models.ts)
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPES = [
  "Bank",
  "Cash",
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
  "Fixed Asset",
  "Accumulated Depreciation",
  "Other Current Asset",
  "Other Asset",
  "Other Current Liability",
  "Long Term Liability",
  "Equity - No Close",
  "Equity - Close",
  "Retained Earnings",
  "Income",
  "Cost of Goods Sold",
  "Expense",
  "Other Income",
  "Other Expense",
  "Tax",
  "Investments",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_CLASSES = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
export type IncomeBalance = "Balance Sheet" | "Income Statement";
export type ConsolidatedRate = "Average" | "Current" | "Historical";

export const TYPES_BY_CLASS: Record<AccountClass, readonly AccountType[]> = {
  Asset: [
    "Bank",
    "Cash",
    "Accounts Receivable",
    "Inventory",
    "Fixed Asset",
    "Accumulated Depreciation",
    "Other Current Asset",
    "Other Asset",
    "Investments",
  ],
  Liability: [
    "Accounts Payable",
    "Other Current Liability",
    "Long Term Liability",
    "Tax",
  ],
  Equity: ["Equity - No Close", "Equity - Close", "Retained Earnings"],
  Revenue: ["Income", "Other Income"],
  Expense: ["Cost of Goods Sold", "Expense", "Other Expense", "Tax"],
};

// Tax is legal under Liability and Expense; Liability wins when the file gives
// no class column, which matches the seeded 2210-2230 tax payable accounts.
export const CLASS_OF_TYPE: Record<AccountType, AccountClass> = (() => {
  const out = {} as Record<AccountType, AccountClass>;
  for (const cls of ACCOUNT_CLASSES) {
    for (const type of TYPES_BY_CLASS[cls]) {
      if (!(type in out)) out[type] = cls;
    }
  }
  return out;
})();

export const INCOME_BALANCE_BY_CLASS: Record<AccountClass, IncomeBalance> = {
  Asset: "Balance Sheet",
  Liability: "Balance Sheet",
  Equity: "Balance Sheet",
  Revenue: "Income Statement",
  Expense: "Income Statement",
};

// The seed rule (20260315000002_exchange-rate-history.sql): equity translates
// at the historical rate, other balance-sheet lines at the closing rate, the
// income statement at the average rate.
export const CONSOLIDATED_RATE_BY_CLASS: Record<AccountClass, ConsolidatedRate> =
  {
    Asset: "Current",
    Liability: "Current",
    Equity: "Historical",
    Revenue: "Average",
    Expense: "Average",
  };

// When a class has several top-level groups (Expense: Cost of Goods Sold,
// Operating Expenses, Other Expenses) and the leaf's own type matches none of
// them, prefer the group with this type.
const DEFAULT_ANCHOR_TYPE: Record<AccountClass, AccountType> = {
  Asset: "Other Current Asset",
  Liability: "Other Current Liability",
  Equity: "Equity - No Close",
  Revenue: "Income",
  Expense: "Expense",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExistingAccount = {
  id: string;
  number: string | null;
  name: string;
  isGroup: boolean;
  isSystem: boolean;
  parentId: string | null;
  class: AccountClass | null;
  accountType: AccountType | null;
  incomeBalance: IncomeBalance;
  active: boolean;
};

export type Resolution =
  | { action: "skip" }
  | { action: "rename"; name: string }
  | { action: "renumber"; number: string }
  | { action: "link"; accountId: string };

export type AccountImportOptions = {
  structure?: "auto" | "file" | "carbon";
  pathSeparator?: string;
  resolutions?: Record<string, Resolution>;
  // True when the mapped Active column is named Inactive / Hidden / Deprecated
  // / Blocked / Archived, so its truthy values mean inactive.
  activeInverted?: boolean;
};

export type PlanContext = {
  existing: ExistingAccount[];
  // csv externalId → account id (externalIntegrationMapping, integration "csv")
  externalIdMap: Map<string, string>;
  // accounts that have journal lines — class may not change, may not deactivate
  postedAccountIds: Set<string>;
  // accounts referenced by accountDefault / fixedAssetClass — may not deactivate
  protectedAccountIds: Set<string>;
};

export type PlanAction =
  | "create"
  | "update"
  | "link"
  | "unchanged"
  | "skip"
  | "error";

export type PlanConflict = {
  existingId: string;
  number: string | null;
  name: string;
  kind: "group" | "account";
  // The "use existing" resolution is only offered when the kinds agree.
  linkable: boolean;
};

export type PlanNode = {
  key: string;
  row: number | null;
  // The row used to attribute a synthesized group's issue in the results UI.
  reportRow: number;
  kind: "group" | "account";
  action: PlanAction;
  reason?: string;
  changes?: string[];
  number: string | null;
  name: string;
  class: AccountClass | null;
  accountType: AccountType | null;
  incomeBalance: IncomeBalance | null;
  consolidatedRate: ConsolidatedRate | null;
  active: boolean;
  externalId: string | null;
  // Exactly one of parentKey (a plan node) / parentId (an existing account) is
  // set for a node that will be written; both null means a new root.
  parentKey: string | null;
  parentId: string | null;
  parentLabel: string | null;
  // Existing account this node resolves to (update / link / unchanged).
  existingId: string | null;
  depth: number;
  // Name of the existing account the top of this node's subtree hangs under.
  anchorLabel: string | null;
  conflict?: PlanConflict;
  promoted?: boolean;
  synthesized?: boolean;
};

export type ImportPlan = {
  structure: "file" | "carbon";
  signal: "rowKind" | "parent" | "path" | null;
  nodes: PlanNode[];
  warnings: string[];
  summary: {
    groupsToCreate: number;
    accountsToCreate: number;
    updates: number;
    linked: number;
    unchanged: number;
    skipped: number;
    errors: number;
  };
};

type SourceRow = {
  index: number;
  number: string | null;
  name: string;
  displayName: string;
  accountType: AccountType | null;
  rawAccountType: string;
  class: AccountClass | null;
  rawClass: string;
  parentRef: string | null;
  isGroup: boolean;
  rowKind: "Account" | "Group" | "Total" | "Heading" | "Ignore";
  indent: number | null;
  active: boolean;
  // False when the file has no Active column: updates then leave `active` alone.
  activeSpecified: boolean;
  externalId: string | null;
  linkAccountId: string | null;
  skipReason: string | null;
  errorReason: string | null;
};

type NodeRef =
  | { kind: "row"; index: number }
  | { kind: "synth"; key: string }
  | { kind: "existing"; id: string };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const norm = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

const isAccountType = (value: string): value is AccountType =>
  (ACCOUNT_TYPES as readonly string[]).includes(value);

const isAccountClass = (value: string): value is AccountClass =>
  (ACCOUNT_CLASSES as readonly string[]).includes(value);

export function parseBoolean(
  value: string | undefined,
  fallback: boolean
): boolean {
  const v = norm(value);
  if (v === "") return fallback;
  if (["true", "yes", "y", "1", "t", "x", "active", "on"].includes(v))
    return true;
  if (
    [
      "false",
      "no",
      "n",
      "0",
      "f",
      "inactive",
      "off",
      "archived",
      "deleted",
      "blocked",
      "hidden",
      "deprecated",
    ].includes(v)
  )
    return false;
  return fallback;
}

// A mapped column whose header says the opposite of "active".
export function isInvertedActiveHeader(header: string | undefined): boolean {
  const h = norm(header);
  return ["inactive", "hidden", "deprecated", "blocked", "archived"].some(
    (word) => h === word || h === `is ${word}`
  );
}

function majority<T extends string>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function planChartOfAccounts(
  records: Record<string, string>[],
  ctx: PlanContext,
  options: AccountImportOptions = {}
): ImportPlan {
  const warnings: string[] = [];
  const resolutions = options.resolutions ?? {};
  const separator = (options.pathSeparator ?? ":").trim() || ":";

  // -- existing chart indexes ------------------------------------------------
  const existingById = new Map(ctx.existing.map((a) => [a.id, a]));
  const existingByNumber = new Map<string, ExistingAccount>();
  const existingByNumberName = new Map<string, ExistingAccount>();
  const existingGroupByName = new Map<string, ExistingAccount>();
  const existingLeafByName = new Map<string, ExistingAccount>();
  for (const a of ctx.existing) {
    if (a.number) {
      existingByNumber.set(norm(a.number), a);
      existingByNumberName.set(`${norm(a.number)} ${norm(a.name)}`, a);
    }
    (a.isGroup ? existingGroupByName : existingLeafByName).set(norm(a.name), a);
  }
  const existingDepth = (a: ExistingAccount): number => {
    let depth = 0;
    const seen = new Set<string>();
    let cur: ExistingAccount | undefined = a;
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = existingById.get(cur.parentId);
      if (!cur) break;
      depth += 1;
    }
    return depth;
  };
  const existingGroups = ctx.existing
    .filter((a) => a.isGroup && a.active)
    .map((a) => ({ account: a, depth: existingDepth(a) }))
    .sort(
      (x, y) => x.depth - y.depth || x.account.name.localeCompare(y.account.name)
    );
  const systemRootFor = (incomeBalance: IncomeBalance) =>
    ctx.existing.find(
      (a) => a.isSystem && a.parentId === null && a.incomeBalance === incomeBalance
    ) ?? null;

  // Shallowest active, non-system group for a class, preferring one whose
  // accountType matches the node's type, then the class's default anchor type.
  const findAnchor = (
    cls: AccountClass,
    type: AccountType | null
  ): ExistingAccount | null => {
    const candidates = existingGroups.filter(
      (g) => !g.account.isSystem && g.account.class === cls
    );
    if (type) {
      const byType = candidates.find((g) => g.account.accountType === type);
      if (byType) return byType.account;
    }
    const preferred = candidates.find(
      (g) => g.account.accountType === DEFAULT_ANCHOR_TYPE[cls]
    );
    if (preferred) return preferred.account;
    if (candidates.length > 0) return candidates[0].account;
    return systemRootFor(INCOME_BALANCE_BY_CLASS[cls]);
  };

  // -- 1. normalise rows -------------------------------------------------------
  const rows: SourceRow[] = records.map((record, index) => {
    const rawKind = (record.rowKind ?? "").trim();
    const rowKind = (
      ["Account", "Group", "Total", "Heading", "Ignore"].includes(rawKind)
        ? rawKind
        : "Account"
    ) as SourceRow["rowKind"];
    const rawType = (record.accountType ?? "").trim();
    const rawClass = (record.class ?? "").trim();
    const indentRaw = (record.indent ?? "").trim();
    const indent = indentRaw === "" ? null : Number.parseInt(indentRaw, 10);
    const activeFromFile = parseBoolean(record.active, true);
    const row: SourceRow = {
      index,
      number: (record.number ?? "").trim() || null,
      name: (record.name ?? "").trim(),
      displayName: (record.name ?? "").trim(),
      accountType: isAccountType(rawType) ? rawType : null,
      rawAccountType: rawType,
      class: isAccountClass(rawClass) ? rawClass : null,
      rawClass,
      parentRef: (record.parent ?? "").trim() || null,
      isGroup:
        rowKind === "Group" ||
        rowKind === "Heading" ||
        parseBoolean(record.isGroup, false),
      rowKind,
      indent: indent === null || Number.isNaN(indent) ? null : indent,
      active:
        options.activeInverted && (record.active ?? "").trim() !== ""
          ? !parseBoolean(record.active, false)
          : activeFromFile,
      activeSpecified: record.active !== undefined,
      externalId: (record.externalId ?? "").trim() || null,
      linkAccountId: null,
      skipReason: null,
      errorReason: null,
    };

    const resolution = resolutions[String(index)];
    if (resolution) {
      switch (resolution.action) {
        case "skip":
          row.skipReason = "Skipped by user";
          break;
        case "rename":
          if (resolution.name.trim()) {
            row.name = resolution.name.trim();
            row.displayName = row.name;
          }
          break;
        case "renumber":
          if (resolution.number.trim()) row.number = resolution.number.trim();
          break;
        case "link":
          row.linkAccountId = resolution.accountId;
          break;
      }
    }

    if (rowKind === "Total") row.skipReason ??= "Total row";
    if (rowKind === "Ignore") row.skipReason ??= "Ignored row kind";
    if (!row.skipReason && row.name === "") {
      row.errorReason = "Missing required Account Name";
    }
    return row;
  });

  // -- 2. structure ------------------------------------------------------------
  const live = rows.filter((r) => !r.skipReason && !r.errorReason);
  const hasRowKind = rows.some((r) =>
    ["Group", "Total", "Heading"].includes(r.rowKind)
  );
  const hasParent = live.some((r) => r.parentRef !== null);
  const hasPath = live.some((r) => r.name.includes(separator));
  let signal: ImportPlan["signal"] = hasRowKind
    ? "rowKind"
    : hasParent
    ? "parent"
    : hasPath
    ? "path"
    : null;
  let structure: ImportPlan["structure"] =
    options.structure === "carbon"
      ? "carbon"
      : options.structure === "file"
      ? "file"
      : signal
      ? "file"
      : "carbon";
  if (structure === "file" && !signal) {
    warnings.push(
      "No hierarchy was found in the file (no Parent Account, Row Kind, or path in the name); accounts are placed under Carbon's existing groups by account type."
    );
    structure = "carbon";
  }
  if (structure === "carbon") signal = null;

  // -- 3. parents ----------------------------------------------------------------
  const parentRefOf = new Map<number, NodeRef | null>();
  const synth = new Map<
    string,
    { key: string; name: string; parentRef: NodeRef | null; firstRow: number }
  >();
  const promoted = new Set<number>();
  const rowByNumber = new Map<string, SourceRow>();
  const rowByNumberName = new Map<string, SourceRow>();
  const rowByName = new Map<string, SourceRow>();
  for (const r of live) {
    if (r.number && !rowByNumber.has(norm(r.number))) {
      rowByNumber.set(norm(r.number), r);
      rowByNumberName.set(`${norm(r.number)} ${norm(r.name)}`, r);
    }
    // Groups win the name slot so "Assets" resolves to the group row when a
    // leaf shares the name.
    const key = norm(r.name);
    const prior = rowByName.get(key);
    if (!prior || (!prior.isGroup && r.isGroup)) rowByName.set(key, r);
  }

  const synthKeyFor = (label: string) => `synth:${norm(label)}`;
  const ensureSynth = (
    label: string,
    parentRef: NodeRef | null,
    firstRow: number,
    keyOverride?: string
  ): NodeRef => {
    const key = keyOverride ?? synthKeyFor(label);
    if (!synth.has(key)) {
      synth.set(key, { key, name: label.trim(), parentRef, firstRow });
    }
    return { kind: "synth", key };
  };

  if (structure === "file" && signal === "rowKind") {
    const stack: Array<{
      ref: NodeRef;
      indent: number | null;
      kind: "group" | "heading";
    }> = [];
    const hasIndent = rows.some((r) => r.indent !== null);
    for (const r of rows) {
      const top = () => (stack.length ? stack[stack.length - 1].ref : null);
      if (hasIndent && r.indent !== null) {
        while (
          stack.length &&
          stack[stack.length - 1].kind === "heading" &&
          (stack[stack.length - 1].indent ?? 0) >= r.indent
        ) {
          stack.pop();
        }
      }
      switch (r.rowKind) {
        case "Total": {
          // Close the nearest open group, discarding any headings above it.
          let idx = stack.length - 1;
          while (idx >= 0 && stack[idx].kind !== "group") idx -= 1;
          if (idx < 0) {
            warnings.push(
              `Row ${r.index + 1}: a Total row closes a group that was never opened; ignored.`
            );
          } else {
            stack.length = idx;
          }
          break;
        }
        case "Group": {
          if (r.skipReason || r.errorReason) break;
          parentRefOf.set(r.index, top());
          stack.push({ ref: { kind: "row", index: r.index }, indent: r.indent, kind: "group" });
          break;
        }
        case "Heading": {
          if (r.skipReason || r.errorReason) break;
          if (!hasIndent) {
            r.skipReason =
              "Heading rows need an Indentation column to be placed; ignored";
            break;
          }
          parentRefOf.set(r.index, top());
          stack.push({ ref: { kind: "row", index: r.index }, indent: r.indent, kind: "heading" });
          break;
        }
        case "Ignore":
          break;
        default: {
          if (r.skipReason || r.errorReason) break;
          parentRefOf.set(r.index, top());
        }
      }
    }
  } else if (structure === "file" && signal === "parent") {
    const resolveParent = (r: SourceRow): NodeRef | null => {
      const ref = r.parentRef;
      if (!ref) return null;
      const key = norm(ref);
      const byRow =
        rowByNumber.get(key) ??
        rowByNumberName.get(key) ??
        rowByName.get(key);
      if (byRow) {
        if (byRow.index === r.index) {
          r.errorReason = "An account cannot be its own parent";
          return null;
        }
        if (!byRow.isGroup) promoted.add(byRow.index);
        return { kind: "row", index: byRow.index };
      }
      const byExisting =
        existingByNumber.get(key) ??
        existingByNumberName.get(key) ??
        existingGroupByName.get(key);
      if (byExisting) {
        if (!byExisting.isGroup) {
          r.errorReason = `Parent "${ref}" is a posting account in Carbon, not a group`;
          return null;
        }
        return { kind: "existing", id: byExisting.id };
      }
      return ensureSynth(ref, null, r.index);
    };
    for (const r of live) parentRefOf.set(r.index, resolveParent(r));
  } else if (structure === "file" && signal === "path") {
    const rowByPath = new Map<string, SourceRow>();
    for (const r of live) rowByPath.set(norm(r.name), r);
    for (const r of live) {
      const segments = r.name
        .split(separator)
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (segments.length <= 1) {
        parentRefOf.set(r.index, null);
        continue;
      }
      r.displayName = segments[segments.length - 1];
      let parentRef: NodeRef | null = null;
      for (let depth = 1; depth < segments.length; depth += 1) {
        const prefix = segments.slice(0, depth).join(separator);
        const matched = rowByPath.get(norm(prefix));
        if (matched && matched.index !== r.index) {
          if (!matched.isGroup) promoted.add(matched.index);
          parentRef = { kind: "row", index: matched.index };
        } else {
          parentRef = ensureSynth(
            segments[depth - 1],
            parentRef,
            r.index,
            `synth:path:${norm(prefix)}`
          );
        }
      }
      parentRefOf.set(r.index, parentRef);
    }
  } else {
    // carbon: file groups are dropped, leaves hang under Carbon's groups.
    for (const r of live) {
      if (r.isGroup) {
        r.skipReason =
          "Group rows are not imported when accounts are placed under Carbon's existing groups";
        continue;
      }
      parentRefOf.set(r.index, null);
    }
  }
  for (const index of promoted) {
    const r = rows[index];
    if (r && !r.skipReason && !r.errorReason) r.isGroup = true;
  }

  // -- 4. nodes ----------------------------------------------------------------
  const nodes = new Map<string, PlanNode>();
  const refKey = (ref: NodeRef | null): string | null =>
    ref === null
      ? null
      : ref.kind === "row"
      ? `row:${ref.index}`
      : ref.kind === "synth"
      ? ref.key
      : `existing:${ref.id}`;

  for (const s of synth.values()) {
    nodes.set(s.key, {
      key: s.key,
      row: null,
      reportRow: s.firstRow,
      kind: "group",
      action: "create",
      number: null,
      name: s.name,
      class: null,
      accountType: null,
      incomeBalance: null,
      consolidatedRate: null,
      active: true,
      externalId: null,
      parentKey: null,
      parentId: null,
      parentLabel: null,
      existingId: null,
      depth: 0,
      anchorLabel: null,
      synthesized: true,
    });
  }
  for (const r of rows) {
    const key = `row:${r.index}`;
    const node: PlanNode = {
      key,
      row: r.index,
      reportRow: r.index,
      kind: r.isGroup ? "group" : "account",
      action: r.skipReason ? "skip" : r.errorReason ? "error" : "create",
      reason: r.skipReason ?? r.errorReason ?? undefined,
      number: r.number,
      name: r.displayName,
      class: r.class,
      accountType: r.accountType,
      incomeBalance: null,
      consolidatedRate: null,
      active: r.active,
      externalId: r.externalId,
      parentKey: null,
      parentId: null,
      parentLabel: null,
      existingId: null,
      depth: 0,
      anchorLabel: null,
      promoted: promoted.has(r.index) || undefined,
    };
    nodes.set(key, node);
  }

  // Wire parents. A parent that is itself a plan node is referenced by key; an
  // existing account by id.
  const parentRefByKey = new Map<string, NodeRef | null>();
  for (const s of synth.values()) parentRefByKey.set(s.key, s.parentRef);
  for (const r of rows) parentRefByKey.set(`row:${r.index}`, parentRefOf.get(r.index) ?? null);
  for (const node of nodes.values()) {
    const ref = parentRefByKey.get(node.key) ?? null;
    if (ref === null) continue;
    if (ref.kind === "existing") {
      node.parentId = ref.id;
      node.parentLabel = existingById.get(ref.id)?.name ?? null;
    } else {
      node.parentKey = refKey(ref);
      node.parentLabel = nodes.get(node.parentKey!)?.name ?? null;
    }
  }
  const children = new Map<string, PlanNode[]>();
  for (const node of nodes.values()) {
    if (node.parentKey) {
      const list = children.get(node.parentKey) ?? [];
      list.push(node);
      children.set(node.parentKey, list);
    }
  }

  const fail = (node: PlanNode, reason: string) => {
    if (node.action === "error" || node.action === "skip") return;
    node.action = "error";
    node.reason = reason;
  };

  // -- 5. leaf typing --------------------------------------------------------------
  for (const node of nodes.values()) {
    if (node.action === "skip" || node.action === "error") continue;
    const r = node.row === null ? null : rows[node.row];
    if (node.kind === "account") {
      if (!node.accountType) {
        fail(
          node,
          r?.rawAccountType
            ? `Account type "${r.rawAccountType}" is not mapped to a Carbon account type`
            : "Account type is required for a posting account"
        );
        continue;
      }
      if (node.class) {
        if (!TYPES_BY_CLASS[node.class].includes(node.accountType)) {
          fail(
            node,
            `Account type "${node.accountType}" is not valid for class ${node.class}`
          );
          continue;
        }
      } else {
        node.class = CLASS_OF_TYPE[node.accountType];
      }
    } else if (node.kind === "group" && r && r.rawClass && !node.class) {
      fail(node, `Class "${r.rawClass}" is not one of Carbon's classes`);
    }
  }

  // -- 6. group class: own column, else majority of descendant leaves, else parent -----
  const descendantLeafClasses = (node: PlanNode): AccountClass[] => {
    const out: AccountClass[] = [];
    for (const child of children.get(node.key) ?? []) {
      if (child.action === "skip" || child.action === "error") continue;
      if (child.kind === "account") {
        if (child.class) out.push(child.class);
      } else {
        out.push(...descendantLeafClasses(child));
      }
    }
    return out;
  };
  const descendantLeafTypes = (node: PlanNode): AccountType[] => {
    const out: AccountType[] = [];
    for (const child of children.get(node.key) ?? []) {
      if (child.action === "skip" || child.action === "error") continue;
      if (child.kind === "account") {
        if (child.accountType) out.push(child.accountType);
      } else {
        out.push(...descendantLeafTypes(child));
      }
    }
    return out;
  };
  for (const node of nodes.values()) {
    if (node.kind !== "group" || node.action === "skip" || node.action === "error")
      continue;
    if (!node.class) node.class = majority(descendantLeafClasses(node));
    if (!node.accountType) {
      const t = majority(descendantLeafTypes(node));
      node.accountType = t && node.class && TYPES_BY_CLASS[node.class].includes(t) ? t : null;
    }
  }

  // Top-down: inherit a missing class from the parent, then resolve anchors and
  // adoption for top-level nodes. Order by depth in the plan tree so parents
  // are settled first.
  const planDepth = (node: PlanNode): number => {
    let depth = 0;
    let cur: PlanNode | undefined = node;
    const seen = new Set<string>();
    while (cur?.parentKey && !seen.has(cur.parentKey)) {
      seen.add(cur.parentKey);
      cur = nodes.get(cur.parentKey);
      depth += 1;
    }
    return depth;
  };
  const ordered = [...nodes.values()].sort(
    (a, b) => planDepth(a) - planDepth(b) || a.reportRow - b.reportRow
  );
  for (const node of ordered) {
    node.depth = planDepth(node);
    if (node.action === "skip" || node.action === "error") continue;
    const parentNode = node.parentKey ? nodes.get(node.parentKey) : undefined;
    const parentExisting = node.parentId ? existingById.get(node.parentId) : undefined;
    if (!node.class && node.kind === "group") {
      // A group with no class column and no leaves under it takes the class
      // of the Carbon group it names (the one it will adopt or update).
      node.class = existingGroupByName.get(norm(node.name))?.class ?? null;
    }
    if (!node.class) {
      node.class = parentNode?.class ?? parentExisting?.class ?? null;
    }
    if (!node.class) {
      fail(
        node,
        node.kind === "group"
          ? "Group has no accounts to derive a class from; add a Class column or an account under it"
          : "Class could not be determined"
      );
      continue;
    }
    node.incomeBalance = INCOME_BALANCE_BY_CLASS[node.class];
    node.consolidatedRate = CONSOLIDATED_RATE_BY_CLASS[node.class];

    if (!node.parentKey && !node.parentId) {
      // Top of a subtree. A group adopts Carbon's group of the same name when
      // the classes agree (or the existing is a root); otherwise it hangs
      // under the class anchor. Leaves always hang under the anchor.
      if (node.kind === "group" && !node.existingId) {
        const adopt = existingGroupByName.get(norm(node.name));
        if (adopt && (adopt.class === null || adopt.class === node.class)) {
          node.existingId = adopt.id;
          node.action = "link";
          node.anchorLabel = adopt.name;
          node.parentId = adopt.parentId;
          node.parentLabel = adopt.parentId ? existingById.get(adopt.parentId)?.name ?? null : null;
          continue;
        }
      }
      const anchor = findAnchor(node.class, node.accountType);
      if (!anchor) {
        fail(node, `No group exists in Carbon to place a ${node.class} account under`);
        continue;
      }
      node.parentId = anchor.id;
      node.parentLabel = anchor.name;
      node.anchorLabel = anchor.name;
    } else {
      node.anchorLabel = parentNode?.anchorLabel ?? parentExisting?.name ?? null;
    }
  }

  // -- 7. identity -------------------------------------------------------------------
  const seenNumbers = new Map<string, PlanNode>();
  const seenNames = new Map<string, PlanNode>();
  const claimed = new Map<string, PlanNode>(); // existing id → node
  const nameKey = (node: PlanNode) => `${node.kind}:${norm(node.name)}`;
  const isPosted = (id: string) => ctx.postedAccountIds.has(id);

  for (const node of ordered) {
    if (node.action === "skip" || node.action === "error") continue;
    const r = node.row === null ? null : rows[node.row];

    // In-file duplicates.
    if (node.number) {
      const dup = seenNumbers.get(norm(node.number));
      if (dup) {
        fail(node, `Duplicate account number "${node.number}" in file (also row ${dup.reportRow + 1})`);
        continue;
      }
    }
    const dupName = seenNames.get(nameKey(node));
    if (dupName) {
      fail(
        node,
        `Duplicate ${node.kind === "group" ? "group" : "account"} name "${node.name}" in file (also row ${dupName.reportRow + 1})`
      );
      continue;
    }

    // Match an existing account.
    let existing: ExistingAccount | undefined;
    let matchedBy: "link" | "externalId" | "number" | "name" | "adopt" | null = null;
    if (node.existingId) {
      existing = existingById.get(node.existingId);
      matchedBy = "adopt";
    } else if (r?.linkAccountId) {
      existing = existingById.get(r.linkAccountId);
      if (!existing) {
        fail(node, "The account chosen in the resolution no longer exists");
        continue;
      }
      matchedBy = "link";
    } else if (node.externalId && ctx.externalIdMap.has(node.externalId)) {
      existing = existingById.get(ctx.externalIdMap.get(node.externalId)!);
      matchedBy = existing ? "externalId" : null;
    }
    if (!existing && node.number) {
      const byNumber = existingByNumber.get(norm(node.number));
      if (byNumber) {
        if (byNumber.isGroup !== (node.kind === "group")) {
          node.conflict = {
            existingId: byNumber.id,
            number: byNumber.number,
            name: byNumber.name,
            kind: byNumber.isGroup ? "group" : "account",
            linkable: false,
          };
          fail(
            node,
            `Number "${node.number}" belongs to the ${byNumber.isGroup ? "group" : "posting account"} "${byNumber.name}" in Carbon`
          );
          continue;
        }
        existing = byNumber;
        matchedBy = "number";
      }
    }
    // Groups are keyed by name (their numbers are cosmetic); leaves only
    // when the file gives no number, since number is a leaf's identity.
    if (!existing && (node.kind === "group" || !node.number)) {
      const byName = (node.kind === "group" ? existingGroupByName : existingLeafByName).get(norm(node.name));
      if (byName) {
        existing = byName;
        matchedBy = "name";
      }
    }

    if (existing && existing.isSystem && node.kind === "account") {
      fail(node, `"${existing.name}" is a system account and cannot be changed`);
      continue;
    }
    if (existing && claimed.has(existing.id)) {
      const other = claimed.get(existing.id)!;
      fail(node, `Also matches Carbon's "${existing.name}" (row ${other.reportRow + 1})`);
      continue;
    }
    // A group that adopts a Carbon group (or a system root) only links to it:
    // the file's number and name are not applied, so they cannot collide.
    if (existing && (matchedBy === "adopt" || existing.isSystem)) {
      claimed.set(existing.id, node);
      node.existingId = existing.id;
      node.action = "link";
      seenNames.set(nameKey(node), node);
      continue;
    }

    // Name / number held by a different account of the same kind.
    const nameOwner = (node.kind === "group" ? existingGroupByName : existingLeafByName).get(norm(node.name));
    if (nameOwner && nameOwner.id !== existing?.id) {
      node.conflict = {
        existingId: nameOwner.id,
        number: nameOwner.number,
        name: nameOwner.name,
        kind: nameOwner.isGroup ? "group" : "account",
        linkable: !existing,
      };
      fail(
        node,
        existing
          ? `Renaming to "${node.name}" collides with ${nameOwner.number ? `${nameOwner.number} ` : ""}"${nameOwner.name}"`
          : `A different ${node.kind === "group" ? "group" : "account"} named "${node.name}"${nameOwner.number ? ` (${nameOwner.number})` : ""} already exists in Carbon`
      );
      continue;
    }
    if (node.number && existing && norm(existing.number) !== norm(node.number)) {
      const numberOwner = existingByNumber.get(norm(node.number));
      if (numberOwner && numberOwner.id !== existing.id) {
        node.conflict = {
          existingId: numberOwner.id,
          number: numberOwner.number,
          name: numberOwner.name,
          kind: numberOwner.isGroup ? "group" : "account",
          linkable: false,
        };
        fail(node, `Renumbering to "${node.number}" collides with "${numberOwner.name}"`);
        continue;
      }
    }

    if (node.number) seenNumbers.set(norm(node.number), node);
    seenNames.set(nameKey(node), node);

    if (!existing) continue; // create

    claimed.set(existing.id, node);
    node.existingId = existing.id;

    // A group matched by name keeps Carbon's number and name; only a move
    // (and its class consequences) counts as a change.
    const groupByName = node.kind === "group" && matchedBy === "name";
    if (groupByName && node.class && existing.class && existing.class !== node.class) {
      fail(
        node,
        `Carbon's group "${existing.name}" is ${existing.class}, but the accounts under it in the file are ${node.class}`
      );
      continue;
    }

    // Changes for an update.
    const changes: string[] = [];
    if (!groupByName && existing.name !== node.name) changes.push(`name: "${existing.name}" → "${node.name}"`);
    if (node.number && !groupByName && (matchedBy === "externalId" || matchedBy === "link" || matchedBy === "name") && norm(existing.number) !== norm(node.number)) {
      changes.push(`number: ${existing.number ?? "—"} → ${node.number}`);
    }
    if (node.kind === "account" && node.accountType && existing.accountType !== node.accountType) {
      changes.push(`type: ${existing.accountType ?? "—"} → ${node.accountType}`);
    }
    if (node.kind === "group" && node.accountType && existing.accountType !== node.accountType && r?.rawAccountType) {
      changes.push(`type: ${existing.accountType ?? "—"} → ${node.accountType}`);
    }
    if (!groupByName && node.class && existing.class !== node.class) {
      if (isPosted(existing.id)) {
        fail(
          node,
          `Class would change from ${existing.class ?? "none"} to ${node.class}, but "${existing.name}" has journal lines; change it in Carbon after reviewing the postings`
        );
        continue;
      }
      changes.push(`class: ${existing.class ?? "—"} → ${node.class}`);
    }
    // Re-parent: intended parent differs from the current one.
    const intendedParentId = node.parentId ?? null;
    const intendedParentKey = node.parentKey ?? null;
    if (intendedParentKey) {
      const parentNode = nodes.get(intendedParentKey);
      if (parentNode?.existingId) {
        if (parentNode.existingId !== existing.parentId) changes.push(`parent: → "${parentNode.name}"`);
      } else {
        changes.push(`parent: → "${parentNode?.name ?? "new group"}"`);
      }
    } else if (intendedParentId && intendedParentId !== existing.parentId) {
      changes.push(`parent: → "${existingById.get(intendedParentId)?.name ?? intendedParentId}"`);
    }
    if (r?.activeSpecified && existing.active !== node.active) {
      if (!node.active) {
        if (ctx.protectedAccountIds.has(existing.id)) {
          fail(node, `"${existing.name}" is a posting default or asset-class account and cannot be deactivated`);
          continue;
        }
        if (isPosted(existing.id)) {
          fail(node, `"${existing.name}" has journal lines and cannot be deactivated by import`);
          continue;
        }
      }
      changes.push(node.active ? "reactivate" : "deactivate");
    }
    node.changes = changes;
    node.action = changes.length ? "update" : groupByName ? "link" : "unchanged";
  }

  // -- 8. parent validity, class agreement, cycles -----------------------------------
  const resolvedParentClass = (node: PlanNode): { cls: AccountClass | null; ok: boolean; reason?: string } => {
    if (node.parentKey) {
      const p = nodes.get(node.parentKey);
      if (!p) return { cls: null, ok: false, reason: "Parent could not be resolved" };
      if (p.action === "error" || p.action === "skip") {
        return { cls: null, ok: false, reason: `Parent "${p.name}" (row ${p.reportRow + 1}) could not be imported` };
      }
      if (p.kind !== "group") {
        return { cls: null, ok: false, reason: `Parent "${p.name}" is a posting account, not a group` };
      }
      return { cls: p.class, ok: true };
    }
    if (node.parentId) {
      const p = existingById.get(node.parentId);
      if (!p) return { cls: null, ok: false, reason: "Parent account not found in Carbon" };
      if (!p.isGroup) return { cls: null, ok: false, reason: `Parent "${p.name}" is a posting account, not a group` };
      return { cls: p.class, ok: true };
    }
    return { cls: null, ok: true };
  };
  for (const node of ordered) {
    if (node.action === "skip" || node.action === "error" || node.action === "link") continue;
    const parent = resolvedParentClass(node);
    if (!parent.ok) {
      fail(node, parent.reason ?? "Parent could not be imported");
      continue;
    }
    if (parent.cls && node.class && parent.cls !== node.class) {
      fail(
        node,
        `Class ${node.class} does not match the parent group "${node.parentLabel ?? ""}" (${parent.cls})`
      );
      continue;
    }
    // Cycle: an existing account moved under one of its own descendants.
    if (node.existingId && (node.action === "update" || node.action === "unchanged")) {
      const walk = (startKey: string | null, startId: string | null): boolean => {
        let key = startKey;
        let id = startId;
        const seen = new Set<string>();
        while (key || id) {
          if (id === node.existingId) return true;
          if (key) {
            if (seen.has(key)) return false;
            seen.add(key);
            const p = nodes.get(key);
            if (!p) return false;
            if (p.existingId === node.existingId) return true;
            key = p.parentKey;
            id = p.parentId;
          } else if (id) {
            if (seen.has(id)) return false;
            seen.add(id);
            const p = existingById.get(id);
            if (!p) return false;
            key = null;
            id = p.parentId;
          }
        }
        return false;
      };
      if (walk(node.parentKey, node.parentId)) {
        fail(node, `Moving "${node.name}" under "${node.parentLabel}" would create a cycle`);
        continue;
      }
    }
  }
  // A failed parent fails its subtree; iterate until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of ordered) {
      if (node.action === "skip" || node.action === "error" || node.action === "link") continue;
      if (!node.parentKey) continue;
      const p = nodes.get(node.parentKey);
      if (p && (p.action === "error" || p.action === "skip")) {
        fail(node, `Parent "${p.name}" (row ${p.reportRow + 1}) could not be imported`);
        changed = true;
      }
    }
  }

  // -- 9. order: depth-first so parents precede children and siblings keep file order --
  const output: PlanNode[] = [];
  const visit = (node: PlanNode) => {
    output.push(node);
    const kids = (children.get(node.key) ?? []).sort((a, b) => a.reportRow - b.reportRow);
    for (const kid of kids) visit(kid);
  };
  for (const node of ordered) {
    if (!node.parentKey) visit(node);
  }
  // Nodes whose parent chain was broken (parentKey to a missing node) — append.
  for (const node of ordered) if (!output.includes(node)) output.push(node);

  const summary = {
    groupsToCreate: output.filter((n) => n.action === "create" && n.kind === "group").length,
    accountsToCreate: output.filter((n) => n.action === "create" && n.kind === "account").length,
    updates: output.filter((n) => n.action === "update").length,
    linked: output.filter((n) => n.action === "link").length,
    unchanged: output.filter((n) => n.action === "unchanged").length,
    skipped: output.filter((n) => n.action === "skip").length,
    errors: output.filter((n) => n.action === "error").length,
  };

  return { structure, signal, nodes: output, warnings, summary };
}
