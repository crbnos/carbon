import { Combobox } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Count,
  cn,
  Input,
  RadioGroup,
  RadioGroupItem,
  Spinner
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { LuFolder, LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { action } from "~/routes/x+/shared+/import.$tableId";
import { path } from "~/utils/path";
import type { ReviewStepProps } from "./reviewSteps";
import { useCsvContext } from "./useCsvContext";

// Mirrors the plan the import-csv edge function returns for `account`
// (packages/database/supabase/functions/import-csv/account-import.ts).
type PlanAction = "create" | "update" | "link" | "unchanged" | "skip" | "error";

type PlanConflict = {
  existingId: string;
  number: string | null;
  name: string;
  kind: "group" | "account";
  linkable: boolean;
};

type PlanNode = {
  key: string;
  row: number | null;
  reportRow: number;
  kind: "group" | "account";
  action: PlanAction;
  reason?: string;
  changes?: string[];
  number: string | null;
  name: string;
  class: string | null;
  accountType: string | null;
  parentLabel: string | null;
  anchorLabel: string | null;
  existingId: string | null;
  existingNumber: string | null;
  existingName: string | null;
  depth: number;
  conflict?: PlanConflict;
  promoted?: boolean;
  synthesized?: boolean;
};

type ImportPlan = {
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

type Resolution =
  | { action: "skip" }
  | { action: "rename"; name: string }
  | { action: "renumber"; number: string }
  | { action: "link"; accountId: string; keepNumber?: boolean }
  | { action: "keepNumber" };

type Resolutions = Record<string, Resolution>;

type Structure = "auto" | "file" | "carbon";

type MatchedNode = PlanNode & { row: number };

const actionVariant: Record<
  PlanAction,
  "green" | "blue" | "gray" | "outline" | "yellow" | "red"
> = {
  create: "green",
  update: "blue",
  link: "outline",
  unchanged: "gray",
  skip: "gray",
  error: "red"
};

const changesNumber = (node: PlanNode) =>
  node.changes?.some((c) => c.startsWith("number:")) ?? false;

const keepsNumber = (r: Resolution | undefined) =>
  r?.action === "keepNumber" || (r?.action === "link" && !!r.keepNumber);

// The step shows one screen at a time: the plan being built, the hierarchy
// question (asked once when the file has none, or on request), or the plan.
type Screen = "preparing" | "structure" | "review";

export function ChartOfAccountsReview({
  table,
  columnMappings,
  enumMappings,
  onReadyChange
}: ReviewStepProps) {
  const { filePath } = useCsvContext();
  const fetcher = useFetcher<typeof action>();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [structure, setStructure] = useState<Structure>("auto");
  const [pathSeparator, setPathSeparator] = useState(":");
  // Resolutions are edited locally (`pending`) and only sent to the planner
  // when the user asks for an updated plan (`applied`), so working through a
  // list of conflicts is not a round-trip per decision. The final submit
  // always carries `pending`.
  const [pending, setPending] = useState<Resolutions>({});
  const [applied, setApplied] = useState<Resolutions>({});
  const [asking, setAsking] = useState(false);
  const [askedOnce, setAskedOnce] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const pendingJson = JSON.stringify(pending);
  const appliedJson = JSON.stringify(applied);
  const dirty = pendingJson !== appliedJson;
  const submitOptionsJson = useMemo(
    () => JSON.stringify({ structure, pathSeparator, resolutions: pending }),
    [structure, pathSeparator, pending]
  );
  const columnMappingsJson = JSON.stringify(columnMappings);
  const enumMappingsJson = JSON.stringify(enumMappings);
  // Everything the plan depends on. The plan on screen is stale until the
  // fetcher has answered for the current key, which is what "loading" means
  // here — not merely whether a request is in flight.
  const inputsKey = JSON.stringify([
    filePath,
    columnMappingsJson,
    enumMappingsJson,
    structure,
    pathSeparator,
    appliedJson
  ]);
  const submittedKey = useRef<string | null>(null);
  const [plannedKey, setPlannedKey] = useState<string | null>(null);

  // Plan on entry, when the structure choice changes, and when the user
  // applies their pending resolutions. Same route and edge function as the
  // real import, minus the write.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised inputs
  useEffect(() => {
    if (!filePath) return;
    submittedKey.current = inputsKey;
    const formData = new FormData();
    formData.set("filePath", filePath);
    for (const [field, column] of Object.entries(columnMappings)) {
      formData.set(field, column);
    }
    formData.set("enumMappings", enumMappingsJson);
    formData.set("dryRun", "true");
    formData.set(
      "options",
      JSON.stringify({ structure, pathSeparator, resolutions: applied })
    );
    fetcherRef.current.submit(formData, {
      method: "post",
      action: path.to.import(table)
    });
  }, [inputsKey, table]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setPlannedKey(submittedKey.current);
    }
  }, [fetcher.state, fetcher.data]);

  const plan =
    fetcher.data?.success && "plan" in fetcher.data
      ? (fetcher.data.plan as ImportPlan | undefined)
      : undefined;
  const failure =
    fetcher.data && fetcher.data.success === false
      ? fetcher.data.message
      : undefined;
  const loading =
    fetcher.state !== "idle" || (!!filePath && plannedKey !== inputsKey);

  // A file with no hierarchy is placed under Carbon's groups; say so once and
  // let the user override before they see the plan.
  const noHierarchy =
    !!plan && structure === "auto" && plan.structure === "carbon";
  const screen: Screen = loading
    ? "preparing"
    : asking || (noHierarchy && !askedOnce)
      ? "structure"
      : "review";

  useEffect(() => {
    onReadyChange?.(screen === "review" && !!plan);
  }, [screen, plan, onReadyChange]);

  const commitStructure = (next: Structure, separator: string) => {
    setAsking(false);
    setAskedOnce(true);
    // Choosing Carbon's groups for a file that has no hierarchy is what the
    // current plan already did; no need to build it again.
    if (next === "carbon" && noHierarchy) return;
    setStructure(next);
    setPathSeparator(separator);
  };

  const attention = plan?.nodes.filter((n) => n.action === "error") ?? [];

  // Rows whose only problem is a name already used by a same-kind account in
  // Carbon — usually the same account (Accounts Receivable, Retained Earnings,
  // the variance accounts) under the customer's own number.
  const linkable = attention.filter(
    (n): n is MatchedNode & { conflict: PlanConflict } =>
      n.row !== null && !!n.conflict?.linkable
  );
  // Matched accounts the plan would renumber to the file's number, plus those
  // already told to keep Carbon's, so either bulk choice can be reversed.
  const renumbering = (plan?.nodes ?? []).filter(
    (n): n is MatchedNode =>
      n.row !== null &&
      n.action !== "error" &&
      n.action !== "skip" &&
      (changesNumber(n) || keepsNumber(applied[String(n.row)]))
  );
  const matching: MatchedNode[] = [...linkable, ...renumbering];

  const setResolution = (row: number, resolution: Resolution | null) =>
    setPending((prev) => {
      const next = { ...prev };
      if (resolution) next[String(row)] = resolution;
      else delete next[String(row)];
      return next;
    });

  // Sets or clears "keep Carbon's number" on a row without losing the
  // account it is linked to.
  const withKeepNumber = (
    current: Resolution | undefined,
    keep: boolean
  ): Resolution | null => {
    if (current?.action === "link") {
      return keep
        ? { ...current, keepNumber: true }
        : { action: "link", accountId: current.accountId };
    }
    if (keep) return { action: "keepNumber" };
    return current?.action === "keepNumber" ? null : (current ?? null);
  };
  // Every matching account takes the file's number (keep = false) or keeps
  // the one it has in Carbon (keep = true).
  const setNumbers = (keep: boolean) =>
    setPending((prev) => {
      const next = { ...prev };
      for (const n of linkable) {
        next[String(n.row)] = keep
          ? {
              action: "link",
              accountId: n.conflict.existingId,
              keepNumber: true
            }
          : { action: "link", accountId: n.conflict.existingId };
      }
      for (const n of renumbering) {
        const r = withKeepNumber(next[String(n.row)], keep);
        if (r) next[String(n.row)] = r;
        else delete next[String(n.row)];
      }
      return next;
    });

  // What the pending choices say about each matching account.
  const choice = (n: MatchedNode) => {
    const r = pending[String(n.row)];
    if (keepsNumber(r)) return "keep";
    if (r?.action === "link" || (!r && changesNumber(n))) return "file";
    return null;
  };
  const keepCount = matching.filter((n) => choice(n) === "keep").length;
  const fileCount = matching.filter((n) => choice(n) === "file").length;
  const undecided = linkable.filter((n) => !pending[String(n.row)]).length;

  // Keys from both sides: an undone resolution is a change too.
  const pendingCount = [
    ...new Set([...Object.keys(pending), ...Object.keys(applied)])
  ].filter(
    (row) => JSON.stringify(pending[row]) !== JSON.stringify(applied[row])
  ).length;
  const updatePlan = () => setApplied(pending);

  const summary = plan ? summarise(plan) : [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <input type="hidden" name="options" value={submitOptionsJson} />

      {screen === "preparing" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <Spinner className="h-6 w-6" />
          <span>
            {plan ? (
              <Trans>Updating the plan…</Trans>
            ) : (
              <Trans>Checking the file against your chart of accounts…</Trans>
            )}
          </span>
        </div>
      )}

      {screen === "structure" && (
        <StructureScreen
          structure={structure}
          pathSeparator={pathSeparator}
          noHierarchy={noHierarchy}
          canCancel={asking}
          onCancel={() => setAsking(false)}
          onContinue={commitStructure}
        />
      )}

      {screen === "review" && (
        <>
          {failure && (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>The plan could not be built</Trans>
              </AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}

          {plan && (
            <>
              <div className="flex flex-col gap-1 text-sm">
                <p>
                  {summary.length > 0 ? (
                    summary.map((part, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed order
                      <Fragment key={i}>
                        {i > 0 && " · "}
                        {part}
                      </Fragment>
                    ))
                  ) : (
                    <Trans>Nothing to import.</Trans>
                  )}
                </p>
                <p className="text-muted-foreground">
                  {plan.structure === "file" ? (
                    plan.signal === "path" ? (
                      <Trans>
                        Hierarchy taken from the paths in the account names.
                      </Trans>
                    ) : plan.signal === "parent" ? (
                      <Trans>
                        Hierarchy taken from the file's parent column.
                      </Trans>
                    ) : (
                      <Trans>
                        Hierarchy taken from the file's Begin-Total / End-Total
                        rows.
                      </Trans>
                    )
                  ) : (
                    <Trans>
                      No hierarchy in the file: accounts are placed under
                      Carbon's existing groups by account type.
                    </Trans>
                  )}{" "}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => setAsking(true)}
                  >
                    <Trans>Change</Trans>
                  </Button>
                </p>
              </div>

              {plan.warnings.map((warning) => (
                <Alert key={warning} variant="warning">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertDescription>{warning}</AlertDescription>
                </Alert>
              ))}

              {matching.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <span className="text-pretty">
                    {undecided > 0 ? (
                      <Plural
                        value={undecided}
                        one="# account already exists in Carbon under another number."
                        other="# accounts already exist in Carbon under other numbers."
                      />
                    ) : keepCount === matching.length ? (
                      <Plural
                        value={keepCount}
                        one="# matching account keeps its Carbon number."
                        other="# matching accounts keep their Carbon numbers."
                      />
                    ) : fileCount === matching.length ? (
                      <Plural
                        value={fileCount}
                        one="# matching account takes the file's number."
                        other="# matching accounts take the file's numbers."
                      />
                    ) : (
                      <Trans>
                        {matching.length} matching accounts: {fileCount} take
                        the file's numbers, {keepCount} keep Carbon's.
                      </Trans>
                    )}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={
                        fileCount === matching.length ? "active" : "secondary"
                      }
                      size="sm"
                      onClick={() => setNumbers(false)}
                    >
                      <Trans>Use the file's numbers</Trans>
                    </Button>
                    <Button
                      variant={
                        keepCount === matching.length ? "active" : "secondary"
                      }
                      size="sm"
                      onClick={() => setNumbers(true)}
                    >
                      <Trans>Keep Carbon's numbers</Trans>
                    </Button>
                  </div>
                </div>
              )}

              {dirty && (
                <Alert variant="info">
                  <LuRefreshCw className="h-4 w-4" />
                  <AlertTitle>
                    <Plural
                      value={pendingCount}
                      one="# decision not in the plan yet"
                      other="# decisions not in the plan yet"
                    />
                  </AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <Trans>
                        Update the plan to see the result. Confirming the import
                        applies them all.
                      </Trans>
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<LuRefreshCw />}
                      onClick={updatePlan}
                    >
                      <Trans>Update plan</Trans>
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {attention.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Trans>Needs attention</Trans>
                    <Count count={attention.length} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      These rows are not imported until they are resolved;
                      everything else imports on confirm.
                    </Trans>
                  </p>
                  <PlanTable
                    rows={attention}
                    pending={pending}
                    applied={applied}
                    onResolve={setResolution}
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto self-start px-0"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? (
                    <Trans>Hide the full list</Trans>
                  ) : (
                    <Plural
                      value={plan.nodes.length}
                      one="Show the only row"
                      other="Show all # rows"
                    />
                  )}
                </Button>
                {showAll && (
                  <PlanTable
                    rows={plan.nodes}
                    pending={pending}
                    applied={applied}
                    onResolve={setResolution}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// One phrase per non-zero count, each with its own plural form.
function summarise(plan: ImportPlan): ReactNode[] {
  const s = plan.summary;
  const parts: ReactNode[] = [];
  if (s.groupsToCreate > 0) {
    parts.push(
      <Trans>
        <Plural value={s.groupsToCreate} one="# group" other="# groups" /> and{" "}
        <Plural value={s.accountsToCreate} one="# account" other="# accounts" />{" "}
        to create
      </Trans>
    );
  } else if (s.accountsToCreate > 0) {
    parts.push(
      <Plural
        value={s.accountsToCreate}
        one="# account to create"
        other="# accounts to create"
      />
    );
  }
  if (s.updates > 0) {
    parts.push(
      <Plural
        value={s.updates}
        one="# account to update"
        other="# accounts to update"
      />
    );
  }
  if (s.linked > 0) {
    parts.push(
      <Plural
        value={s.linked}
        one="# account merged into an existing one"
        other="# accounts merged into existing ones"
      />
    );
  }
  if (s.unchanged > 0) {
    parts.push(
      <Plural
        value={s.unchanged}
        one="# account unchanged"
        other="# accounts unchanged"
      />
    );
  }
  if (s.skipped > 0) {
    parts.push(
      <Plural value={s.skipped} one="# row skipped" other="# rows skipped" />
    );
  }
  if (s.errors > 0) {
    parts.push(
      <Plural
        value={s.errors}
        one="# row needs attention"
        other="# rows need attention"
      />
    );
  }
  return parts;
}

// Asks how the accounts should be organised. Local draft; committed on
// Continue so a look at the options never rebuilds the plan by itself.
function StructureScreen({
  structure,
  pathSeparator,
  noHierarchy,
  canCancel,
  onCancel,
  onContinue
}: {
  structure: Structure;
  pathSeparator: string;
  noHierarchy: boolean;
  canCancel: boolean;
  onCancel: () => void;
  onContinue: (structure: Structure, pathSeparator: string) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<Structure>(
    noHierarchy && structure === "auto" ? "carbon" : structure
  );
  const [separator, setSeparator] = useState(pathSeparator);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">
          <Trans>How should the accounts be organised?</Trans>
        </div>
        {noHierarchy && (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No parent column, row kinds, or paths in the names were found in
              the file.
            </Trans>
          </p>
        )}
      </div>
      <RadioGroup
        value={draft}
        onValueChange={(value) => setDraft(value as Structure)}
        className="flex flex-col gap-3"
      >
        {!noHierarchy && (
          <StructureOption
            value="auto"
            label={t`Detect from the file`}
            description={t`Use the file's parent column, name paths, or total rows when present.`}
          />
        )}
        <StructureOption
          value="file"
          label={t`Use the hierarchy in the file`}
          description={
            noHierarchy
              ? t`Split the account names on a separator, e.g. Parent:Child.`
              : t`Groups come from the file. A top-level group with the same name as a Carbon group is merged into it.`
          }
        />
        <StructureOption
          value="carbon"
          label={t`Place accounts under Carbon's existing groups`}
          description={t`Ignore the file's groups; each account goes under the Carbon group that matches its account type.`}
        />
      </RadioGroup>
      {draft !== "carbon" && (
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <Trans>Path separator in account names</Trans>
          </span>
          <Input
            size="sm"
            className="w-16"
            value={separator}
            onChange={(e) => setSeparator(e.target.value)}
          />
        </label>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onContinue(draft, separator)}
        >
          <Trans>Continue</Trans>
        </Button>
        {canCancel && (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}

function StructureOption({
  value,
  label,
  description
}: {
  value: Structure;
  label: string;
  description: string;
}) {
  const id = `coa-structure-${value}`;
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <label htmlFor={id} className="flex cursor-pointer flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </label>
    </div>
  );
}

// The plan rows. Each node is a main row plus, when there is something to
// say, a detail row under the account name holding the reason / changes and
// the resolution, full width, so nothing needs a sideways scroll.
function PlanTable({
  rows,
  pending,
  applied,
  onResolve
}: {
  rows: PlanNode[];
  pending: Resolutions;
  applied: Resolutions;
  onResolve: (row: number, resolution: Resolution | null) => void;
}) {
  const { t } = useLingui();

  const describe = (node: PlanNode, resolution: Resolution): string => {
    switch (resolution.action) {
      case "skip":
        return t`Skip`;
      case "rename":
        return t`Import as "${resolution.name}"`;
      case "renumber":
        return t`Import as ${resolution.number}`;
      case "link": {
        const named = node.conflict ?? {
          number: node.existingNumber,
          name: node.existingName
        };
        const target =
          [named.number, named.name].filter(Boolean).join(" ") ||
          resolution.accountId;
        return resolution.keepNumber
          ? t`Same as ${target}, keeping its number`
          : t`Same as ${target}`;
      }
      case "keepNumber":
        return t`Keep Carbon's number`;
    }
  };

  return (
    <div className="w-full min-w-0 max-h-[420px] overflow-y-auto rounded-md border border-border">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-28" />
          <col className="w-24" />
          <col />
          <col className="w-48" />
          <col className="w-44" />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              <Trans>Line</Trans>
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              <Trans>Action</Trans>
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              <Trans>Number</Trans>
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              <Trans>Account</Trans>
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              <Trans>Under</Trans>
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              <Trans>Type</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => {
            const resolution =
              node.row === null ? undefined : pending[String(node.row)];
            const resolutionDirty =
              node.row !== null &&
              JSON.stringify(pending[String(node.row)]) !==
                JSON.stringify(applied[String(node.row)]);
            const detail =
              node.action === "error" || node.action === "skip"
                ? node.reason
                : node.changes?.join("; ");
            const hasDetail =
              !!detail || node.action === "update" || !!resolution;
            return (
              <Fragment key={node.key}>
                <tr
                  className={cn(
                    hasDetail ? "border-0" : "border-b border-border",
                    node.action === "error" && "bg-destructive/5"
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">
                    {node.row === null ? "—" : node.row + 2}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <ActionBadge action={node.action} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    {node.number ?? ""}
                  </td>
                  <td className="min-w-0 px-3 py-2 align-top">
                    <div
                      className="flex min-w-0 items-center gap-1.5"
                      style={{ paddingLeft: `${node.depth * 16}px` }}
                    >
                      {node.kind === "group" && (
                        <LuFolder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate" title={node.name}>
                        {node.name}
                      </span>
                      {node.promoted && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          <Trans>(group)</Trans>
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="truncate px-3 py-2 align-top text-muted-foreground"
                    title={node.parentLabel ?? node.anchorLabel ?? ""}
                  >
                    {node.parentLabel ?? node.anchorLabel ?? ""}
                  </td>
                  <td
                    className="truncate px-3 py-2 align-top text-muted-foreground"
                    title={node.accountType ?? node.class ?? ""}
                  >
                    {node.accountType ?? node.class ?? ""}
                  </td>
                </tr>
                {hasDetail && (
                  <tr
                    className={cn(
                      "border-b border-border",
                      node.action === "error" && "bg-destructive/5"
                    )}
                  >
                    <td colSpan={2} />
                    <td colSpan={4} className="px-3 pb-3 pt-0 align-top">
                      <div className="flex flex-col gap-2">
                        {detail && (
                          <p
                            className={cn(
                              "text-pretty text-sm",
                              node.action === "error"
                                ? "text-destructive"
                                : "text-muted-foreground"
                            )}
                          >
                            {detail}
                          </p>
                        )}
                        {resolution && (
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge
                              variant={resolutionDirty ? "yellow" : "outline"}
                            >
                              {resolutionDirty ? (
                                <Trans>Pending</Trans>
                              ) : (
                                <Trans>Resolved</Trans>
                              )}
                            </Badge>
                            <span>{describe(node, resolution)}</span>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto px-0"
                              onClick={() =>
                                onResolve(node.row as number, null)
                              }
                            >
                              <Trans>Undo</Trans>
                            </Button>
                          </div>
                        )}
                        {!resolution &&
                          node.action === "error" &&
                          node.row !== null && (
                            <ResolutionPicker
                              node={node}
                              onChange={(r) => onResolve(node.row as number, r)}
                            />
                          )}
                        {!resolution &&
                          node.action === "update" &&
                          node.row !== null && (
                            <div className="flex flex-wrap gap-3">
                              {changesNumber(node) && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto px-0"
                                  onClick={() =>
                                    onResolve(node.row as number, {
                                      action: "keepNumber"
                                    })
                                  }
                                >
                                  <Trans>Keep Carbon's number</Trans>
                                </Button>
                              )}
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto px-0"
                                onClick={() =>
                                  onResolve(node.row as number, {
                                    action: "skip"
                                  })
                                }
                              >
                                <Trans>Leave this account as it is</Trans>
                              </Button>
                            </div>
                          )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                <Trans>No rows here.</Trans>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// A component rather than a helper taking `t`: the Lingui macro only
// transforms `t` obtained from useLingui() in the same scope.
function ActionBadge({ action }: { action: PlanAction }) {
  const { t } = useLingui();
  const label: Record<PlanAction, string> = {
    create: t`Create`,
    update: t`Update`,
    link: t`Existing`,
    unchanged: t`Unchanged`,
    skip: t`Skip`,
    error: t`Attention`
  };
  return <Badge variant={actionVariant[action]}>{label[action]}</Badge>;
}

// Picks a resolution for a flagged row. The choice is recorded as pending;
// rename / renumber ask for the value first and commit on Enter or Apply.
function ResolutionPicker({
  node,
  onChange
}: {
  node: PlanNode;
  onChange: (resolution: Resolution) => void;
}) {
  const { t } = useLingui();
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");

  const target = node.conflict
    ? [node.conflict.number, node.conflict.name].filter(Boolean).join(" ")
    : "";
  const options = [
    { value: "skip", label: t`Skip this row` },
    { value: "rename", label: t`Import under a different name` },
    { value: "renumber", label: t`Import under a different number` },
    ...(node.conflict?.linkable
      ? [
          {
            value: "link",
            label: t`Same as ${target} (use this file's number)`
          },
          {
            value: "link-keep",
            label: t`Same as ${target} (keep its number)`
          }
        ]
      : [])
  ];

  const suggestion = (action: string) =>
    action === "rename"
      ? node.number
        ? `${node.name} (${node.number})`
        : `${node.name} (imported)`
      : action === "renumber" && node.number
        ? `${node.number}-1`
        : "";

  const commit = (action: string, value: string) => {
    if (action === "rename" && value.trim())
      onChange({ action: "rename", name: value.trim() });
    else if (action === "renumber" && value.trim())
      onChange({ action: "renumber", number: value.trim() });
  };

  return (
    <div className="flex max-w-md flex-col gap-2">
      <Combobox
        name={`resolution-${node.row}`}
        value={kind}
        options={options}
        isOptional
        onChange={(option) => {
          const action = option?.value ?? "";
          setKind(action);
          if (action === "skip") {
            onChange({ action: "skip" });
          } else if (action === "link" && node.conflict) {
            onChange({ action: "link", accountId: node.conflict.existingId });
          } else if (action === "link-keep" && node.conflict) {
            onChange({
              action: "link",
              accountId: node.conflict.existingId,
              keepNumber: true
            });
          } else if (action === "rename" || action === "renumber") {
            setText(suggestion(action));
          }
        }}
      />
      {(kind === "rename" || kind === "renumber") && (
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(kind, text);
              }
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => commit(kind, text)}
          >
            <Trans>Apply</Trans>
          </Button>
        </div>
      )}
    </div>
  );
}
