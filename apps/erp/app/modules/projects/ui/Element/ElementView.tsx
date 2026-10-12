// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Subheading,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Fragment, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuChevronRight,
  LuCornerDownRight,
  LuEllipsisVertical,
  LuLink,
  LuListPlus,
  LuPackageMinus,
  LuTimer,
  LuTrash
} from "react-icons/lu";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuditLogFeed } from "~/components/AuditLog";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useUser } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import type { ProjectElementPage } from "../../projects.server";
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
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
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

type ElementViewProps = ProjectElementPage & {
  projectId: string;
  project: Project | undefined;
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
};

/**
 * The element's own page, as a Linear issue: a breadcrumb row with the ⋯
 * menu, then a readable main column (the title, the description, Children,
 * Plan, Links, Time & materials, Activity — each only when it has something)
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
  links,
  verification,
  requirementStatus,
  qualityDocuments,
  itemFields,
  states,
  labels,
  milestones
}: ElementViewProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const changeRequestId = useActiveChangeRequestId();
  const childQuickAddRef = useRef<HTMLInputElement>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [planAddRequest, setPlanAddRequest] = useState(0);
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
  const canAddChild = canCreate && element.type !== "Parameter";

  // t and i open Log time and Issue material. Never while typing or with a
  // dialog open.
  useShortcutKeyMap([
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
  const showPlan = planLineCount > 0 || planAddRequest > 0;
  const showLinks = elementLinkCount > 0 || addingLink;
  const showChildren = children.length > 0 || addingChild;
  const showTime = ledger.length > 0 || openTime.length > 0;

  // The Plan page with the layout and filters the element came from.
  const query = searchParams.toString();
  const planPath = `${path.to.projectElements(projectId)}${query ? `?${query}` : ""}`;
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
                to={`${path.to.projectElement(projectId, ancestor.id)}${query ? `?${query}` : ""}`}
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
              <DropdownMenuItem
                disabled={!canLogTime}
                onClick={() => setLoggingTime(true)}
              >
                <DropdownMenuIcon icon={<LuTimer />} />
                <Trans>Log time</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canIssue}
                onClick={() => setIssuing(true)}
              >
                <DropdownMenuIcon icon={<LuPackageMinus />} />
                <Trans>Issue material</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canAddChild} onClick={addChild}>
                <DropdownMenuIcon icon={<LuCornerDownRight />} />
                <Trans>Add child</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => setAddingLink(true)}
              >
                <DropdownMenuIcon icon={<LuLink />} />
                <Trans>Add link</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => setPlanAddRequest((n) => n + 1)}
              >
                <DropdownMenuIcon icon={<LuListPlus />} />
                <Trans>Add plan line</Trans>
              </DropdownMenuItem>
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

      <div className="@container flex min-h-0 flex-1 overflow-y-auto @min-[56rem]:overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col @min-[56rem]:flex-row">
          <main className="min-w-0 flex-1 @min-[56rem]:overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[800px] flex-col gap-8 px-8 py-8">
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
                  <ElementTypeIcon type={element.type} className="size-3.5" />
                  {element.readableId}
                </span>
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

              {showPlan && (
                <Section title={t`Plan`} count={planLineCount}>
                  <ElementPlanLines
                    projectId={projectId}
                    elementId={element.id}
                    planLines={planLines}
                    laborCategories={laborCategories}
                    defaultLocationId={project?.locationId}
                    isDisabled={!canUpdate}
                    addRequest={planAddRequest}
                  />
                </Section>
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

              {showTime && (
                <Section title={t`Time & materials`}>
                  <ElementTimeAndMaterials
                    ledger={ledger}
                    openTime={openTime}
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
            className="shrink-0 border-t border-border px-5 py-6 @min-[56rem]:w-[300px] @min-[56rem]:overflow-y-auto @min-[56rem]:border-t-0 @min-[56rem]:border-l"
          />
        </div>
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
          action={withChangeRequest(
            path.to.deleteProjectElement(projectId, element.id),
            changeRequestId
          )}
          name={element.readableId}
          text={t`Delete ${element.readableId} and every element below it? An element that has costs, time, a job or a purchase order line cannot be deleted.`}
          onCancel={() => setDeleting(false)}
          onSubmit={() => setDeleting(false)}
        />
      )}
    </div>
  );
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
