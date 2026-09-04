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
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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

export function ChartOfAccountsReview({
  table,
  columnMappings,
  enumMappings
}: ReviewStepProps) {
  const { t } = useLingui();
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
  const [bucket, setBucket] = useState<"attention" | "all">("all");

  const pendingJson = JSON.stringify(pending);
  const appliedJson = JSON.stringify(applied);
  const dirty = pendingJson !== appliedJson;
  const submitOptionsJson = useMemo(
    () => JSON.stringify({ structure, pathSeparator, resolutions: pending }),
    [structure, pathSeparator, pending]
  );
  const columnMappingsJson = JSON.stringify(columnMappings);
  const enumMappingsJson = JSON.stringify(enumMappings);

  // Plan on entry, when the structure choice changes, and when the user
  // applies their pending resolutions. Same route and edge function as the
  // real import, minus the write.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised inputs
  useEffect(() => {
    if (!filePath) return;
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
  }, [
    filePath,
    columnMappingsJson,
    enumMappingsJson,
    structure,
    pathSeparator,
    appliedJson,
    table
  ]);

  const plan =
    fetcher.data?.success && "plan" in fetcher.data
      ? (fetcher.data.plan as ImportPlan | undefined)
      : undefined;
  const failure =
    fetcher.data && fetcher.data.success === false
      ? fetcher.data.message
      : undefined;
  const loading = fetcher.state !== "idle";

  const attention = plan?.nodes.filter((n) => n.action === "error") ?? [];
  const rows = bucket === "attention" ? attention : (plan?.nodes ?? []);

  // Rows whose only problem is a name already used by a same-kind account in
  // Carbon — usually the same account (Accounts Receivable, Retained Earnings,
  // the variance accounts) under the customer's own number.
  const linkable = attention.filter(
    (n): n is PlanNode & { row: number; conflict: PlanConflict } =>
      n.row !== null && !!n.conflict?.linkable
  );
  // Matched accounts the plan would renumber to the file's number, plus those
  // already told to keep Carbon's, so either bulk choice can be reversed.
  const keepsNumber = (r: Resolution | undefined) =>
    r?.action === "keepNumber" || (r?.action === "link" && !!r.keepNumber);
  const renumbering = (plan?.nodes ?? []).filter(
    (n): n is PlanNode & { row: number } =>
      n.row !== null &&
      n.action !== "error" &&
      n.action !== "skip" &&
      (changesNumber(n) || keepsNumber(applied[String(n.row)]))
  );

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
  const useFileNumbers = () => setNumbers(false);
  const keepCarbonNumbers = () => setNumbers(true);
  const matchingCount = linkable.length + renumbering.length;

  const pendingCount = Object.keys(pending).filter(
    (row) => JSON.stringify(pending[row]) !== JSON.stringify(applied[row])
  ).length;
  const updatePlan = () => setApplied(pending);

  // Attention rows get a Tabs default once the first plan arrives.
  const firstPlan = useRef(true);
  useEffect(() => {
    if (plan && firstPlan.current) {
      firstPlan.current = false;
      if (plan.summary.errors > 0) setBucket("attention");
    }
  }, [plan]);

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
    <div className="flex min-w-0 flex-col gap-4">
      <input type="hidden" name="options" value={submitOptionsJson} />

      <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-4">
        <div className="text-sm font-medium">
          <Trans>How should the accounts be organised?</Trans>
        </div>
        <RadioGroup
          value={structure}
          onValueChange={(value) => setStructure(value as Structure)}
          className="flex flex-col gap-2"
        >
          <StructureOption
            value="auto"
            label={t`Detect from the file`}
            description={
              plan
                ? plan.structure === "file"
                  ? plan.signal === "path"
                    ? t`Found a path in the account names, e.g. Parent:Child.`
                    : plan.signal === "parent"
                      ? t`Found a parent column.`
                      : t`Found Begin-Total / End-Total rows.`
                  : t`No hierarchy in the file; accounts go under Carbon's existing groups by account type.`
                : t`Use the file's parent column, name paths, or total rows when present.`
            }
          />
          <StructureOption
            value="file"
            label={t`Use the hierarchy in the file`}
            description={t`Groups come from the file. A top-level group with the same name as a Carbon group is merged into it.`}
          />
          <StructureOption
            value="carbon"
            label={t`Place accounts under Carbon's existing groups`}
            description={t`Ignore the file's groups; each account goes under the Carbon group that matches its account type.`}
          />
        </RadioGroup>
        {structure !== "carbon" && (
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              <Trans>Path separator in account names</Trans>
            </span>
            <Input
              size="sm"
              className="w-16"
              value={pathSeparator}
              onChange={(e) => setPathSeparator(e.target.value)}
            />
          </label>
        )}
      </div>

      {failure && (
        <Alert variant="destructive">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>The plan could not be built</Trans>
          </AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      {plan?.warnings.map((warning) => (
        <Alert key={warning} variant="warning">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      {plan && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="green">
            <Trans>
              {plan.summary.groupsToCreate} groups,{" "}
              {plan.summary.accountsToCreate} accounts to create
            </Trans>
          </Badge>
          <Badge variant="blue">
            <Trans>{plan.summary.updates} to update</Trans>
          </Badge>
          <Badge variant="outline">
            <Trans>{plan.summary.linked} merged into existing</Trans>
          </Badge>
          <Badge variant="gray">
            <Trans>
              {plan.summary.unchanged} unchanged, {plan.summary.skipped} skipped
            </Trans>
          </Badge>
          {plan.summary.errors > 0 && (
            <Badge variant="red">
              <Trans>{plan.summary.errors} need attention</Trans>
            </Badge>
          )}
          {loading && <Spinner className="h-4 w-4" />}
        </div>
      )}

      {plan && (matchingCount > 0 || plan.summary.errors > 0) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            {plan.summary.errors > 0 ? (
              <Trans>
                Rows that need attention are not imported. Resolve them here,
                fix the file, or import the rest now and the remainder later.
              </Trans>
            ) : (
              <Trans>
                Matching accounts are updated in place; choose whose numbers
                they keep.
              </Trans>
            )}
          </p>
          {matchingCount > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={useFileNumbers}>
                <Trans>
                  Use the file's numbers for {matchingCount} matching accounts
                </Trans>
              </Button>
              <Button variant="secondary" size="sm" onClick={keepCarbonNumbers}>
                <Trans>Keep Carbon's numbers</Trans>
              </Button>
            </div>
          )}
        </div>
      )}

      {dirty && (
        <Alert variant="info">
          <LuRefreshCw className="h-4 w-4" />
          <AlertTitle>
            <Trans>{pendingCount} change(s) not yet in the plan</Trans>
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <Trans>
                Keep resolving rows, then update the plan to see the result.
                Confirming the import applies them all.
              </Trans>
            </span>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<LuRefreshCw />}
              isLoading={loading}
              onClick={updatePlan}
            >
              <Trans>Update plan</Trans>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {plan && (
        <>
          <Tabs
            value={bucket}
            onValueChange={(value) => setBucket(value as "attention" | "all")}
          >
            <TabsList>
              <TabsTrigger value="all" className="gap-1.5">
                <Trans>All rows</Trans>
                <Count count={plan.nodes.length} />
              </TabsTrigger>
              <TabsTrigger value="attention" className="gap-1.5">
                <Trans>Needs attention</Trans>
                <Count count={attention.length} />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div
            className={cn(
              "w-full min-w-0 max-h-[420px] overflow-y-auto rounded-md border border-border",
              loading && "opacity-60"
            )}
          >
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
                          {/* The reason and the resolution sit under the
                              account name, full width, so nothing needs a
                              sideways scroll. */}
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
                                    variant={
                                      resolutionDirty ? "yellow" : "outline"
                                    }
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
                                      setResolution(node.row as number, null)
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
                                    onChange={(r) =>
                                      setResolution(node.row as number, r)
                                    }
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
                                          setResolution(node.row as number, {
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
                                        setResolution(node.row as number, {
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
        </>
      )}

      {!plan && !failure && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          <Trans>Building the plan…</Trans>
        </div>
      )}
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
