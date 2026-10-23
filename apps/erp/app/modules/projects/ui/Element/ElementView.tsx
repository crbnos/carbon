// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, type ReactNode, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuChevronRight,
  LuCornerDownRight,
  LuEllipsisVertical,
  LuFactory,
  LuLink,
  LuListOrdered,
  LuPackageMinus,
  LuReceipt,
  LuTimer,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import { JiraIssueDialog } from "~/components/ActionTasks/Jira/IssueDialog";
import { LinearIssueDialog } from "~/components/ActionTasks/Linear/IssueDialog";
import { AuditLogFeed } from "~/components/AuditLog";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { usePlanGate } from "~/hooks/usePlanGate";
import { useResolved } from "~/hooks/useResolved";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import {
  isProjectPlanLocked,
  projectPlanLockedMessage
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.service";
import type {
  Project,
  ProjectLabel,
  ProjectMilestone,
  ProjectState
} from "../../types";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useElementField } from "../Elements/ElementProperties";
import { useElementRoutes } from "../Elements/ElementRoutes";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
import { ChargeCostModal } from "./ChargeCostModal";
import { ElementChildren } from "./ElementChildren";
import { ElementComments } from "./ElementComments";
import { ElementDescription } from "./ElementDescription";
import { ElementLinks } from "./ElementLinks";
import { ElementPlanLines } from "./ElementPlanLines";
import { ElementSidebar } from "./ElementSidebar";
import { ElementTimeAndMaterials } from "./ElementTimeAndMaterials";
import { ElementTypeBlock, hasTypeBlock } from "./ElementTypeBlock";
import { IssueMaterialModal } from "./IssueMaterialModal";
import { LogTimeModal } from "./LogTimeModal";
import { NewJobModal } from "./NewJobModal";

type ElementViewProps = ProjectElementPage & {
  projectId: string;
  project: Project | undefined;
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  /** The open change request (`?cr=`), when the page shows one. */
  changeRequest?: { status: string } | null;
  /** The element's Linear and Jira links (`externalIntegrationMapping.metadata`). */
  linearIssue?: unknown;
  jiraIssue?: unknown;
  /**
   * The charge actions of the ⋯ menu in place of Log time and Issue material
   * (a service order's, which post through its charge route); null for none
   * (a service template takes no charges).
   */
  chargeActions?: ReactNode | null;
  /**
   * The element's charges in the Actual tab (a service order's);
   * null while it has none.
   */
  charges?: ReactNode | null;
  /** Fields added to the sidebar's Work group (a service element's fixed price). */
  workFields?: ReactNode;
};

/**
 * The element's own page, as a Linear issue: a breadcrumb row with the ⋯
 * menu, then a readable main column (the title, the description, Children,
 * Costs (Estimated and Actual tabs), Links, Activity — each only when it
 * has something)
 * beside the properties column.
 */
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
  planActuals,
  links,
  verification,
  requirementStatus,
  qualityDocuments,
  itemFields,
  states,
  labels,
  milestones,
  changeRequest,
  linearIssue,
  jiraIssue,
  chargeActions,
  charges,
  workFields
}: ElementViewProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const integrations = useIntegrations();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const routes = useElementRoutes(projectId);
  const isProject = routes.module === "projects";
  const changeRequestId = useActiveChangeRequestId();
  const childQuickAddRef = useRef<HTMLInputElement>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Each charge modal opens empty (the ⋯ menu, the Actual tab, a shortcut)
  // or set to a plan line (its card on the Estimated tab).
  const [loggingTime, setLoggingTime] = useState<{
    laborCategoryId?: string;
  } | null>(null);
  const [issuing, setIssuing] = useState<{
    itemId?: string;
    quantity?: number;
  } | null>(null);
  const [charging, setCharging] = useState<{
    description?: string;
    amount?: number;
  } | null>(null);
  const [costView, setCostView] = useState<CostView | null>(null);
  const [creatingJob, setCreatingJob] = useState(false);

  const isClosed = project?.status === "Closed";
  const canUpdate = permissions.can("update", routes.module) && !isClosed;
  const canCreate = permissions.can("create", routes.module) && !isClosed;
  const canDelete = permissions.can("delete", routes.module) && !isClosed;
  // Charges need a chargeable element of an open project; the posting
  // functions refuse anything else with the reason.
  const canCharge = element.isChargeable && !isClosed;
  // A page with its own charge actions handles its own shortcuts.
  const usesProjectCharges = chargeActions === undefined;
  const canLogTime =
    usesProjectCharges && canCharge && permissions.is("employee");
  const canIssue =
    usesProjectCharges &&
    canCharge &&
    permissions.can("update", "inventory") &&
    permissions.can("update", "projects");
  const canChargeCost =
    usesProjectCharges && canCharge && permissions.can("update", "projects");
  const canAddChild = canCreate && element.type !== "Parameter";
  // New Job: a job for a Make part, charged to this element, with a plan
  // line added for it. A project's, not a service order's.
  const showNewJob = isProject && element.type !== "Parameter";
  const canCreateJob = canCharge && permissions.can("create", "production");
  // After the lock milestone completes, the plan changes only through a
  // Draft change request: "Add line" is off, with the Plan page's reason.
  const lockMilestone = milestones.find(
    (milestone) => milestone.id === project?.lockPlanAfterMilestoneId
  );
  const planLockMessage =
    lockMilestone &&
    isProjectPlanLocked({ lockMilestone }) &&
    changeRequest?.status !== "Draft"
      ? projectPlanLockedMessage(lockMilestone.name)
      : null;

  // t and i open Log time and Issue material. Never while typing or with a
  // dialog open.
  useShortcutKeyMap([
    {
      shortcut: PROJECT_SHORTCUTS.logTime,
      action: (event) => {
        if (!canLogTime) return;
        event.preventDefault();
        setLoggingTime({});
      }
    },
    {
      shortcut: PROJECT_SHORTCUTS.issueMaterial,
      action: (event) => {
        if (!canIssue) return;
        event.preventDefault();
        setIssuing({});
      }
    }
  ]);

  const children = useMemo(
    () =>
      elements
        .filter((e) => e.parentId === element.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [elements, element.id]
  );

  // The breadcrumb: the project, then every ancestor, top first.
  const ancestors = useMemo(() => {
    const byId = new Map(elements.map((e) => [e.id, e]));
    const chain: { id: string; readableId: string; name: string }[] = [];
    const seen = new Set<string>([element.id]);
    let parentId = element.parent?.id ?? null;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    return chain;
  }, [elements, element.id, element.parent?.id]);

  const elementLinkCount = links.filter(
    (link) =>
      link.fromElementId === element.id || link.toElementId === element.id
  ).length;
  const planLineCount =
    planLines.materials.length +
    planLines.labor.length +
    planLines.costs.length;
  // An element that can have plan lines (every type but a Parameter) shows
  // the plan with its "Add line" to a user who can edit, even with no lines.
  const showPlan =
    planLineCount > 0 || (canUpdate && element.type !== "Parameter");
  // The Linear and Jira issue buttons sit at the right of the readable id
  // (issue-sync).
  const issueButtons =
    canUpdate && (integrations.has("linear") || integrations.has("jira")) ? (
      <>
        {integrations.has("linear") && (
          <LinearIssueDialog
            entityType="projectElement"
            taskId={element.id}
            linkedIssue={linearIssue}
          />
        )}
        {integrations.has("jira") && (
          <JiraIssueDialog
            entityType="projectElement"
            taskId={element.id}
            linkedIssue={jiraIssue}
          />
        )}
      </>
    ) : null;
  // Links trace requirements and tests: a project's, not a service order's.
  const showLinks = isProject && (elementLinkCount > 0 || addingLink);
  const showChildren = children.length > 0 || addingChild;
  // A page with charges of its own shows them instead (null: none yet).
  const showTime =
    charges === undefined && (ledger.length > 0 || openTime.length > 0);
  // Costs: what the element is estimated to cost, and what has actually
  // been charged to it. Before the project is released there is nothing
  // actual yet, so it opens on the estimate; afterwards on the actuals.
  const showCosts =
    element.type !== "Parameter" || planLineCount > 0 || showTime;
  const selectedCostView =
    costView ??
    (!project || project.status === "Draft" ? "estimated" : "actual");

  // The Plan page with the layout and filters the element came from.
  const query = searchParams.toString();
  const planPath = `${routes.list}${query ? `?${query}` : ""}`;
  const goBack = () => {
    // A page reached from inside the app goes back where it came from;
    // a page opened from a link goes to the Plan.
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate(planPath);
  };

  const addChild = () => {
    setAddingChild(true);
    requestAnimationFrame(() => childQuickAddRef.current?.focus());
  };
  // Renumber WBS clears the pinned codes of the element's subtree.
  const renumberFetcher = useFetcher();
  const subtreeHasPinnedCode = useMemo(() => {
    const ids = new Set([element.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of elements) {
        if (e.parentId && ids.has(e.parentId) && !ids.has(e.id)) {
          ids.add(e.id);
          grew = true;
        }
      }
    }
    return elements.some((e) => ids.has(e.id) && e.wbsCode);
  }, [elements, element.id]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <nav
          aria-label={t`Breadcrumb`}
          className="flex min-w-0 items-center gap-1 text-sm"
        >
          <IconButton
            aria-label={t`Back`}
            icon={<LuArrowLeft />}
            variant="ghost"
            size="sm"
            onClick={goBack}
          />
          <Link
            to={planPath}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {project?.identifier ?? <Trans>Plan</Trans>}
          </Link>
          {ancestors.map((ancestor) => (
            <Fragment key={ancestor.id}>
              <LuChevronRight className="size-3 shrink-0 text-muted-foreground" />
              <Link
                to={`${routes.element(ancestor.id)}${query ? `?${query}` : ""}`}
                title={ancestor.name}
                className="min-w-0 max-w-48 truncate rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {ancestor.name}
              </Link>
            </Fragment>
          ))}
          <LuChevronRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate px-1.5 py-0.5">
            {element.readableId}
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Copy text={element.readableId} />
          {showNewJob && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuFactory />}
              isDisabled={!canCreateJob}
              onClick={() => setCreatingJob(true)}
            >
              <Trans>New Job</Trans>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {usesProjectCharges ? (
                <>
                  <DropdownMenuItem
                    disabled={!canLogTime}
                    onClick={() => setLoggingTime({})}
                  >
                    <DropdownMenuIcon icon={<LuTimer />} />
                    <Trans>Log time</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canIssue}
                    onClick={() => setIssuing({})}
                  >
                    <DropdownMenuIcon icon={<LuPackageMinus />} />
                    <Trans>Issue material</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canChargeCost}
                    onClick={() => setCharging({})}
                  >
                    <DropdownMenuIcon icon={<LuReceipt />} />
                    <Trans>Charge cost</Trans>
                  </DropdownMenuItem>
                </>
              ) : (
                chargeActions
              )}
              {chargeActions !== null && <DropdownMenuSeparator />}
              <DropdownMenuItem disabled={!canAddChild} onClick={addChild}>
                <DropdownMenuIcon icon={<LuCornerDownRight />} />
                <Trans>Add child</Trans>
              </DropdownMenuItem>
              {isProject && (
                <DropdownMenuItem
                  disabled={!canUpdate}
                  onClick={() => setAddingLink(true)}
                >
                  <DropdownMenuIcon icon={<LuLink />} />
                  <Trans>Add link</Trans>
                </DropdownMenuItem>
              )}
              {isProject && subtreeHasPinnedCode && (
                <DropdownMenuItem
                  disabled={!canUpdate}
                  onClick={() =>
                    renumberFetcher.submit(
                      { elementId: element.id },
                      {
                        method: "post",
                        action: path.to.projectWbsRenumber(projectId)
                      }
                    )
                  }
                >
                  <DropdownMenuIcon icon={<LuListOrdered />} />
                  <Trans>Renumber WBS</Trans>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
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
        </div>
      </div>

      {/* Each scroll box is `relative`: a switch's hidden input and a label's
          sr-only text are absolutely positioned, and without a positioned
          scroll box they belong to the app shell's scroller, which then
          scrolls the whole page to them on focus. */}
      <div className="@container relative flex min-h-0 flex-1 overflow-y-auto @min-[56rem]:overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col @min-[56rem]:flex-row">
          <main className="relative min-w-0 flex-1 @min-[56rem]:overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[800px] flex-col gap-8 px-8 py-8">
              <div className="flex flex-col gap-2">
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                    <ElementTypeIcon type={element.type} className="size-3.5" />
                    {element.readableId}
                  </span>
                  {issueButtons && (
                    <div className="flex shrink-0 items-center gap-1">
                      {issueButtons}
                    </div>
                  )}
                </div>
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
              </div>

              {(showChildren || canAddChild) && (
                <Section
                  title={showChildren ? t`Children` : undefined}
                  count={children.length}
                >
                  <ElementChildren
                    projectId={projectId}
                    parent={element}
                    children={children}
                    states={states}
                    labels={labels}
                    requirementStatus={requirementStatus}
                    canUpdate={canUpdate}
                    canCreate={canAddChild}
                    isAdding={addingChild}
                    onAddingChange={setAddingChild}
                    quickAddRef={childQuickAddRef}
                  />
                </Section>
              )}

              {showCosts && (
                <section className="flex w-full flex-col gap-3">
                  <Tabs
                    value={selectedCostView}
                    onValueChange={(next) => setCostView(next as CostView)}
                    className="flex w-full flex-col gap-3"
                  >
                    <TabsList aria-label={t`Costs`} className="self-start">
                      <TabsTrigger value="estimated">
                        <Trans>Estimated</Trans>
                      </TabsTrigger>
                      <TabsTrigger value="actual">
                        <Trans>Actual</Trans>
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="estimated">
                      {showPlan ? (
                        <ElementPlanLines
                          projectId={projectId}
                          elementId={element.id}
                          planLines={planLines}
                          planActuals={planActuals}
                          laborCategories={laborCategories}
                          defaultLocationId={project?.locationId}
                          isDisabled={!canUpdate}
                          canSupply={isProject}
                          addDisabledReason={planLockMessage}
                          onIssue={canIssue ? setIssuing : undefined}
                          onLogTime={canLogTime ? setLoggingTime : undefined}
                          onCharge={canChargeCost ? setCharging : undefined}
                        />
                      ) : (
                        <EmptyCosts>
                          <Trans>No estimated costs.</Trans>
                        </EmptyCosts>
                      )}
                    </TabsContent>
                    <TabsContent value="actual">
                      {charges !== undefined ? (
                        (charges ?? (
                          <EmptyCosts>
                            <Trans>Nothing has been charged yet.</Trans>
                          </EmptyCosts>
                        ))
                      ) : (
                        <ElementTimeAndMaterials
                          ledger={ledger}
                          openTime={openTime}
                          elementReadableId={element.readableId}
                          laborCategories={laborCategories}
                          onIssue={canIssue ? () => setIssuing({}) : undefined}
                          onLogTime={
                            canLogTime ? () => setLoggingTime({}) : undefined
                          }
                          onCharge={
                            canChargeCost ? () => setCharging({}) : undefined
                          }
                        />
                      )}
                    </TabsContent>
                  </Tabs>
                </section>
              )}

              {showLinks && (
                <Section title={t`Links`} count={elementLinkCount}>
                  <ElementLinks
                    projectId={projectId}
                    element={element}
                    elements={elements}
                    links={links}
                    isDisabled={!canUpdate}
                    isAdding={addingLink}
                    onAddingChange={setAddingLink}
                  />
                </Section>
              )}

              <Section title={t`Activity`}>
                <ElementActivity
                  projectId={projectId}
                  element={element}
                  comments={comments}
                />
              </Section>
            </div>
          </main>
          <ElementSidebar
            projectId={projectId}
            element={element}
            elements={elements}
            capitalAsset={capitalAsset}
            costTreatment={project?.costTreatment ?? null}
            costObjective={project?.costObjective ?? null}
            costSummary={costSummary}
            states={states}
            labels={labels}
            milestones={milestones}
            isDisabled={!canUpdate}
            workFields={workFields}
            typeBlock={
              hasTypeBlock(element.type) ? (
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
              ) : undefined
            }
            className="relative shrink-0 border-t border-border px-5 py-6 @min-[56rem]:w-[300px] @min-[56rem]:overflow-y-auto @min-[56rem]:border-t-0 @min-[56rem]:border-l"
          />
        </div>
      </div>

      {loggingTime && (
        <LogTimeModal
          projectId={projectId}
          element={element}
          laborCategories={laborCategories}
          defaultLaborCategoryId={
            loggingTime.laborCategoryId ?? defaultLaborCategoryId
          }
          onClose={() => setLoggingTime(null)}
        />
      )}
      {issuing && (
        <IssueMaterialModal
          projectId={projectId}
          element={element}
          defaultLocationId={project?.locationId}
          defaultItemId={issuing.itemId}
          defaultQuantity={issuing.quantity}
          onClose={() => setIssuing(null)}
        />
      )}
      {creatingJob && (
        <NewJobModal
          projectId={projectId}
          element={element}
          defaultLocationId={project?.locationId}
          onClose={() => setCreatingJob(false)}
        />
      )}
      {charging && (
        <ChargeCostModal
          projectId={projectId}
          element={element}
          defaultDescription={charging.description}
          defaultAmount={charging.amount || undefined}
          onClose={() => setCharging(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={withChangeRequest(routes.remove(element.id), changeRequestId)}
          name={element.readableId}
          text={t`Delete ${element.readableId} and every element below it? An element that has costs, time, a job or a purchase order line cannot be deleted.`}
          onCancel={() => setDeleting(false)}
          onSubmit={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

type CostView = "estimated" | "actual";

/** The muted line a cost tab shows while it has nothing to list. */
function EmptyCosts({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** The name as a large inline editable title. It saves on blur and Enter. */
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
      className="-mx-1 w-full rounded-md bg-transparent px-1 text-2xl font-semibold tracking-tight outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring disabled:hover:bg-transparent"
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

/** A plain section: a small heading with a muted count, then its content. */
function Section({
  title,
  count,
  children
}: {
  title?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-2">
      {title && (
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {count !== undefined && count > 0 && (
            <span className="text-muted-foreground tabular-nums">{count}</span>
          )}
        </h2>
      )}
      {children}
    </section>
  );
}

/**
 * Activity, as Linear does it: the comments, then the history feed under
 * them with no heading of its own. The feed shows only while the audit log
 * is on and the user may read it; otherwise its "not enabled" block would
 * be a large empty gap.
 */
function ElementActivity({
  projectId,
  element,
  comments
}: Pick<ProjectElementPage, "element" | "comments"> & { projectId: string }) {
  const { company } = useUser();
  const { can } = usePermissions();
  const { isGated } = usePlanGate({ feature: "AUDIT_LOG" });
  const rootRouteData = useRouteData<{ auditLogEnabled: Promise<boolean> }>(
    path.to.authenticatedRoot
  );
  const auditLogEnabled = useResolved(rootRouteData?.auditLogEnabled, false);
  const showHistory = auditLogEnabled && !isGated && can("view", "settings");
  return (
    <div className="flex w-full flex-col gap-4">
      <ElementComments
        projectId={projectId}
        elementId={element.id}
        comments={comments}
      />
      {showHistory && (
        <AuditLogFeed
          entityType="projectElement"
          entityId={element.id}
          companyId={company.id}
          isActive
          refreshKey={element.updatedAt}
        />
      )}
    </div>
  );
}
