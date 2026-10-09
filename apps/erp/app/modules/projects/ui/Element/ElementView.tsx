// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Subheading,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuCornerDownRight,
  LuEllipsis,
  LuMaximize2,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuditLogFeed } from "~/components/AuditLog";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  useCurrencyFormatter,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import type { CostTotals } from "../../projects.models";
import { rollUpCostSummary } from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import type {
  Project,
  ProjectLabel,
  ProjectMilestone,
  ProjectState
} from "../../types";
import type { PillShortcutField } from "../Elements/ElementProperties";
import {
  PillShortcutProvider,
  useElementField,
  usePillShortcutRequest
} from "../Elements/ElementProperties";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
import { ElementChildren } from "./ElementChildren";
import { ElementComments } from "./ElementComments";
import { ElementDescription } from "./ElementDescription";
import { ElementLinks } from "./ElementLinks";
import { ElementPlanLines } from "./ElementPlanLines";
import { ElementSidebar } from "./ElementSidebar";
import {
  ElementTimeAndMaterials,
  TimeAndMaterialsActions
} from "./ElementTimeAndMaterials";
import { ElementTypeBlock, hasTypeBlock } from "./ElementTypeBlock";
import { IssueMaterialModal } from "./IssueMaterialModal";
import { LogTimeModal } from "./LogTimeModal";

type ElementViewProps = ProjectElementPage & {
  projectId: string;
  project: Project | undefined;
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  /** `peek` sits beside the list with close and open-full buttons. */
  variant: "peek" | "page";
};

const NO_COST: CostTotals = { plan: 0, committed: 0, actual: 0, hours: 0 };

export function ElementView({
  projectId,
  project,
  element,
  capitalAsset,
  elements,
  comments,
  planLines,
  costSummary,
  laborCategories,
  defaultLaborCategoryId,
  ledger,
  openTime,
  links,
  verification,
  requirementStatus,
  qualityDocuments,
  itemFields,
  itemHistory,
  states,
  labels,
  milestones,
  variant
}: ElementViewProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const childQuickAddRef = useRef<HTMLInputElement>(null);
  const [childrenOpen, setChildrenOpen] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [loggingTime, setLoggingTime] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const isClosed = project?.status === "Closed";
  const canUpdate = permissions.can("update", "projects") && !isClosed;
  const canCreate = permissions.can("create", "projects") && !isClosed;
  const canDelete = permissions.can("delete", "projects") && !isClosed;
  // Charges need a chargeable element of an open project; the posting
  // functions refuse anything else with the reason.
  const canCharge = element.isChargeable && !isClosed;
  const canLogTime = canCharge && permissions.is("employee");
  const canIssue =
    canCharge &&
    permissions.can("update", "inventory") &&
    permissions.can("update", "projects");
  // s / a / p / l open the sidebar's pills; t and i open Log time and Issue
  // material. Never while typing or with a dialog open (useShortcutKeyMap).
  const [pillRequest, setPillRequest] = usePillShortcutRequest();
  const openPill = (field: PillShortcutField) => (event: KeyboardEvent) => {
    event.preventDefault();
    setPillRequest({ elementId: element.id, field });
  };
  useShortcutKeyMap([
    { shortcut: PROJECT_SHORTCUTS.state, action: openPill("state") },
    { shortcut: PROJECT_SHORTCUTS.owner, action: openPill("owner") },
    { shortcut: PROJECT_SHORTCUTS.priority, action: openPill("priority") },
    { shortcut: PROJECT_SHORTCUTS.labels, action: openPill("labels") },
    {
      shortcut: PROJECT_SHORTCUTS.logTime,
      action: (event) => {
        if (!canLogTime) return;
        event.preventDefault();
        setLoggingTime(true);
      }
    },
    {
      shortcut: PROJECT_SHORTCUTS.issueMaterial,
      action: (event) => {
        if (!canIssue) return;
        event.preventDefault();
        setIssuing(true);
      }
    }
  ]);

  const chargeActions = (
    <TimeAndMaterialsActions
      canLogTime={canLogTime}
      canIssue={canIssue}
      onLogTime={() => setLoggingTime(true)}
      onIssue={() => setIssuing(true)}
    />
  );

  const children = useMemo(
    () =>
      elements
        .filter((e) => e.parentId === element.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [elements, element.id]
  );

  const elementLinkCount = links.filter(
    (link) =>
      link.fromElementId === element.id || link.toElementId === element.id
  ).length;

  const query = searchParams.toString();
  const listPath = `${path.to.projectElements(projectId)}${query ? `?${query}` : ""}`;

  const addChild = () => {
    setChildrenOpen(true);
    requestAnimationFrame(() => childQuickAddRef.current?.focus());
  };

  return (
    <div className="@container flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <HStack spacing={2} className="min-w-0">
          {element.parent && (
            <Link
              to={path.to.projectElement(projectId, element.parent.id)}
              className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="shrink-0 font-mono">
                {element.parent.readableId}
              </span>
              <span className="truncate">{element.parent.name}</span>
            </Link>
          )}
          {element.parent && (
            <LuChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
          <ElementTypeIcon type={element.type} />
          <span className="whitespace-nowrap font-mono text-sm">
            {element.readableId}
          </span>
          <Copy text={element.readableId} label={t`Copy id`} variant="ghost" />
        </HStack>
        <HStack spacing={1} className="shrink-0">
          {variant === "peek" && (
            <IconButton
              aria-label={t`Open as a page`}
              icon={<LuMaximize2 />}
              variant="ghost"
              onClick={() =>
                navigate(path.to.projectElementFull(projectId, element.id))
              }
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsis />}
                variant="ghost"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                destructive
                disabled={!canDelete}
                onClick={() => setDeleting(true)}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {variant === "peek" && (
            <IconButton
              aria-label={t`Close`}
              icon={<LuX />}
              variant="ghost"
              onClick={() => navigate(listPath)}
            />
          )}
        </HStack>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @min-[56rem]:flex-row @min-[56rem]:overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-5 @min-[56rem]:overflow-y-auto">
          <ElementName
            key={`${element.id}:${element.name}`}
            projectId={projectId}
            elementId={element.id}
            name={element.name}
            isDisabled={!canUpdate}
          />
          <ElementDescription
            key={element.id}
            projectId={projectId}
            elementId={element.id}
            description={element.description}
            isDisabled={!canUpdate}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              leftIcon={<LuCornerDownRight />}
              isDisabled={!canCreate}
              onClick={addChild}
            >
              <Trans>Add child</Trans>
            </Button>
            {chargeActions}
          </div>

          {hasTypeBlock(element.type) && (
            <Section
              title={
                element.type === "Requirement"
                  ? t`Requirement`
                  : element.type === "Test Case"
                    ? t`Test case`
                    : t`Parameter`
              }
            >
              <ElementTypeBlock
                key={element.id}
                projectId={projectId}
                element={element}
                elements={elements}
                verification={verification}
                requirementStatus={requirementStatus}
                qualityDocuments={qualityDocuments}
                itemFields={itemFields}
                isDisabled={!canUpdate}
              />
            </Section>
          )}
          <Section title={t`Trace links`} count={elementLinkCount}>
            <ElementLinks
              projectId={projectId}
              element={element}
              elements={elements}
              links={links}
              isDisabled={!canUpdate}
            />
          </Section>
          <Section
            title={t`Children`}
            open={childrenOpen}
            onOpenChange={setChildrenOpen}
            count={children.length}
          >
            <ElementChildren
              projectId={projectId}
              identifier={project?.identifier ?? ""}
              parent={element}
              children={children}
              states={states}
              canUpdate={canUpdate}
              canCreate={canCreate}
              quickAddRef={childQuickAddRef}
            />
          </Section>
          <Section title={t`Plan`}>
            <ElementPlanLines
              projectId={projectId}
              elementId={element.id}
              planLines={planLines}
              laborCategories={laborCategories}
              defaultLocationId={project?.locationId}
              isDisabled={!canUpdate}
            />
          </Section>
          <Section title={t`Time & materials`}>
            <ElementTimeAndMaterials
              ledger={ledger}
              openTime={openTime}
              actions={chargeActions}
            />
          </Section>
          <Section title={t`Budget`}>
            <ElementBudget
              element={element}
              elements={elements}
              costSummary={costSummary}
              itemHistory={itemHistory}
            />
          </Section>
          <Section title={t`Activity`}>
            <ElementActivity
              projectId={projectId}
              element={element}
              comments={comments}
            />
          </Section>
        </div>
        <PillShortcutProvider value={pillRequest}>
          <ElementSidebar
            projectId={projectId}
            element={element}
            capitalAsset={capitalAsset}
            costTreatment={project?.costTreatment ?? null}
            states={states}
            labels={labels}
            milestones={milestones}
            isDisabled={!canUpdate}
            className="shrink-0 border-t border-border px-4 py-5 @min-[56rem]:w-80 @min-[56rem]:overflow-y-auto @min-[56rem]:border-t-0 @min-[56rem]:border-l"
          />
        </PillShortcutProvider>
      </div>

      {loggingTime && (
        <LogTimeModal
          projectId={projectId}
          element={element}
          laborCategories={laborCategories}
          defaultLaborCategoryId={defaultLaborCategoryId}
          onClose={() => setLoggingTime(false)}
        />
      )}
      {issuing && (
        <IssueMaterialModal
          projectId={projectId}
          element={element}
          defaultLocationId={project?.locationId}
          onClose={() => setIssuing(false)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={path.to.deleteProjectElement(projectId, element.id)}
          name={element.readableId}
          text={t`Delete ${element.readableId} and every element below it? An element that has costs, time, a job or a purchase order line cannot be deleted.`}
          onCancel={() => setDeleting(false)}
          onSubmit={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

/** The name as an inline editable heading. It saves on blur and on Enter. */
function ElementName({
  projectId,
  elementId,
  name,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  name: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { submit } = useElementField(projectId, elementId, "name");
  return (
    <input
      aria-label={t`Name`}
      defaultValue={name}
      disabled={isDisabled}
      className="w-full rounded-md bg-transparent px-1 -mx-1 text-xl font-semibold tracking-tight outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring disabled:hover:bg-transparent"
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (!next) {
          event.target.value = name;
          return;
        }
        if (next !== name) submit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = name;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Section({
  title,
  count,
  open,
  onOpenChange,
  children
}: {
  title: string;
  count?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={open === undefined ? true : undefined}
      open={open}
      onOpenChange={onOpenChange}
      className="w-full"
    >
      <CollapsibleTrigger className="group/section mb-2 flex items-center gap-1 text-sm font-medium">
        <LuChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]/section:-rotate-90" />
        {title}
        {count !== undefined && count > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Plan, budget, committed, actual, remaining and estimate at completion, for
 * the element alone and with its children. The estimate is the plan, or the
 * committed and actual cost when they already exceed it.
 */
function ElementBudget({
  element,
  elements,
  costSummary,
  itemHistory
}: Pick<
  ProjectElementPage,
  "element" | "elements" | "costSummary" | "itemHistory"
>) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();

  const { own, subtree, subtreeBudget } = useMemo(() => {
    const { byElement } = rollUpCostSummary(elements, costSummary);
    const ownRow = costSummary.find((r) => r.projectElementId === element.id);
    const ownTotals: CostTotals = ownRow
      ? {
          plan:
            Number(ownRow.planMaterial) +
            Number(ownRow.planLabor) +
            Number(ownRow.planOther),
          committed: Number(ownRow.committed),
          actual: Number(ownRow.actual),
          hours: Number(ownRow.actualHours)
        }
      : NO_COST;

    const childrenOf = new Map<string, string[]>();
    for (const e of elements) {
      if (!e.parentId) continue;
      childrenOf.set(e.parentId, [...(childrenOf.get(e.parentId) ?? []), e.id]);
    }
    const budgets = new Map(elements.map((e) => [e.id, e.budget]));
    let total: number | null = null;
    const stack = [element.id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const budget = budgets.get(id);
      if (budget !== null && budget !== undefined) {
        total = (total ?? 0) + Number(budget);
      }
      stack.push(...(childrenOf.get(id) ?? []));
    }

    return {
      own: ownTotals,
      subtree: byElement.get(element.id) ?? NO_COST,
      subtreeBudget: total
    };
  }, [elements, costSummary, element.id]);

  const ownBudget = element.budget === null ? null : Number(element.budget);
  const money = (value: number | null) =>
    value === null ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className={cn("tabular-nums", value < 0 && "text-red-500")}>
        {formatMoney.format(value)}
      </span>
    );
  const remaining = (totals: CostTotals, budget: number | null) =>
    (budget ?? totals.plan) - totals.committed - totals.actual;
  const estimate = (totals: CostTotals) =>
    Math.max(totals.plan, totals.committed + totals.actual);

  const rows: { label: string; own: number | null; subtree: number | null }[] =
    [
      { label: t`Plan`, own: own.plan, subtree: subtree.plan },
      { label: t`Budget`, own: ownBudget, subtree: subtreeBudget },
      { label: t`Committed`, own: own.committed, subtree: subtree.committed },
      { label: t`Actual`, own: own.actual, subtree: subtree.actual },
      {
        label: t`Remaining`,
        own: remaining(own, ownBudget),
        subtree: remaining(subtree, subtreeBudget)
      },
      {
        label: t`Estimate at completion`,
        own: estimate(own),
        subtree: estimate(subtree)
      }
    ];

  const pastCount = itemHistory?.elementCount ?? 0;
  const pastHours = formatQuantity(Number(itemHistory?.averageHours ?? 0));
  const pastMaterial = formatMoney.format(
    Number(itemHistory?.averageMaterialCost ?? 0)
  );

  return (
    <div className="flex w-full flex-col gap-2">
      {element.itemId && pastCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {t`Past average: ${pastHours} h and ${pastMaterial} in materials over ${pastCount} elements`}
        </p>
      )}
      <div className="w-full overflow-x-auto rounded-md border border-border">
        <TableBase full>
          <Thead>
            <Tr>
              <Th />
              <Th>
                <Trans>This element</Trans>
              </Th>
              <Th>
                <Trans>With children</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.label}>
                <Td className="text-muted-foreground">{row.label}</Td>
                <Td>{money(row.own)}</Td>
                <Td>{money(row.subtree)}</Td>
              </Tr>
            ))}
          </Tbody>
        </TableBase>
      </div>
    </div>
  );
}

function ElementActivity({
  projectId,
  element,
  comments
}: Pick<ProjectElementPage, "element" | "comments"> & { projectId: string }) {
  const { company } = useUser();
  const { isGated } = usePlanGate({ feature: "AUDIT_LOG" });
  return (
    <div className="flex w-full flex-col gap-6">
      <ElementComments
        projectId={projectId}
        elementId={element.id}
        comments={comments}
      />
      <div className="flex flex-col gap-2">
        <Subheading as="h3" variant="light">
          <Trans>History</Trans>
        </Subheading>
        <AuditLogFeed
          entityType="projectElement"
          entityId={element.id}
          companyId={company.id}
          planRestricted={isGated}
          isActive
          refreshKey={element.updatedAt}
        />
      </div>
    </div>
  );
}
