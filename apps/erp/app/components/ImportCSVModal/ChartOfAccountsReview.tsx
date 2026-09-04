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
import { useEffect, useMemo, useRef, useState } from "react";
import { LuFolder, LuTriangleAlert } from "react-icons/lu";
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
  | { action: "link"; accountId: string };

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
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    {}
  );
  const [bucket, setBucket] = useState<"attention" | "all">("all");

  const optionsJson = useMemo(
    () => JSON.stringify({ structure, pathSeparator, resolutions }),
    [structure, pathSeparator, resolutions]
  );
  const columnMappingsJson = JSON.stringify(columnMappings);
  const enumMappingsJson = JSON.stringify(enumMappings);

  // Re-plan whenever the inputs change. The dry run goes through the same
  // route and edge function as the real import, minus the write.
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
    formData.set("options", optionsJson);
    fetcherRef.current.submit(formData, {
      method: "post",
      action: path.to.import(table)
    });
  }, [filePath, columnMappingsJson, enumMappingsJson, optionsJson, table]);

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

  const setResolution = (row: number, resolution: Resolution | null) => {
    setResolutions((prev) => {
      const next = { ...prev };
      if (resolution) next[String(row)] = resolution;
      else delete next[String(row)];
      return next;
    });
  };

  // Attention rows get a Tabs default once the first plan arrives.
  const firstPlan = useRef(true);
  useEffect(() => {
    if (plan && firstPlan.current) {
      firstPlan.current = false;
      if (plan.summary.errors > 0) setBucket("attention");
    }
  }, [plan]);

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="options" value={optionsJson} />

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

      {plan && plan.summary.errors > 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Rows that need attention are not imported. Resolve them here, fix
            the file, or import the rest now and the remainder later.
          </Trans>
        </p>
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
              "w-full min-w-0 max-h-[420px] overflow-auto rounded-md border border-border",
              loading && "opacity-60"
            )}
          >
            <table className="w-max min-w-full border-collapse text-sm">
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
                  <th className="min-w-[240px] whitespace-nowrap px-3 py-2 font-medium">
                    <Trans>Account</Trans>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">
                    <Trans>Under</Trans>
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">
                    <Trans>Type</Trans>
                  </th>
                  <th className="min-w-[320px] whitespace-nowrap px-3 py-2 font-medium">
                    <Trans>Details</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((node) => (
                  <tr
                    key={node.key}
                    className={cn(
                      "border-b border-border last:border-0",
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
                    <td className="px-3 py-2 align-top">
                      <div
                        className="flex items-center gap-1.5"
                        style={{ paddingLeft: `${node.depth * 16}px` }}
                      >
                        {node.kind === "group" && (
                          <LuFolder className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate" title={node.name}>
                          {node.name}
                        </span>
                        {node.promoted && (
                          <span className="text-xs text-muted-foreground">
                            <Trans>(group)</Trans>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">
                      {node.parentLabel ?? node.anchorLabel ?? ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">
                      {node.accountType ?? node.class ?? ""}
                    </td>
                    <td
                      className={cn(
                        "max-w-[460px] px-3 py-2 align-top",
                        node.action === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {node.action === "error" || node.action === "skip"
                        ? node.reason
                        : (node.changes?.join("; ") ?? "")}
                      {node.action === "error" && node.row !== null && (
                        <div className="mt-2">
                          <ResolutionPicker
                            node={node}
                            resolution={resolutions[String(node.row)]}
                            onChange={(resolution) =>
                              setResolution(node.row as number, resolution)
                            }
                          />
                        </div>
                      )}
                      {/* An update rewrites an account that matched by
                          number; the reviewer can leave it as it is. */}
                      {node.action === "update" && node.row !== null && (
                        <div>
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
                      {node.action === "skip" &&
                        node.row !== null &&
                        resolutions[String(node.row)]?.action === "skip" && (
                          <div>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto px-0"
                              onClick={() =>
                                setResolution(node.row as number, null)
                              }
                            >
                              <Trans>Include this row again</Trans>
                            </Button>
                          </div>
                        )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
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

function ResolutionPicker({
  node,
  resolution,
  onChange
}: {
  node: PlanNode;
  resolution: Resolution | undefined;
  onChange: (resolution: Resolution | null) => void;
}) {
  const { t } = useLingui();
  const kind = resolution?.action ?? "";
  const [text, setText] = useState(
    resolution?.action === "rename"
      ? resolution.name
      : resolution?.action === "renumber"
        ? resolution.number
        : ""
  );

  const options = [
    { value: "skip", label: t`Skip this row` },
    { value: "rename", label: t`Import under a different name` },
    { value: "renumber", label: t`Import under a different number` },
    ...(node.conflict?.linkable
      ? [
          {
            value: "link",
            label: t`Same as ${[node.conflict.number, node.conflict.name].filter(Boolean).join(" ")}`
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
    <div className="flex flex-col gap-2">
      <Combobox
        name={`resolution-${node.row}`}
        value={kind}
        options={options}
        isOptional
        onChange={(option) => {
          const action = option?.value ?? "";
          if (!action) {
            onChange(null);
            setText("");
          } else if (action === "skip") {
            onChange({ action: "skip" });
          } else if (action === "link" && node.conflict) {
            onChange({ action: "link", accountId: node.conflict.existingId });
          } else {
            const initial = suggestion(action);
            setText(initial);
            commit(action, initial);
          }
        }}
      />
      {(kind === "rename" || kind === "renumber") && (
        <Input
          size="sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(kind, text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(kind, text);
            }
          }}
        />
      )}
    </div>
  );
}
