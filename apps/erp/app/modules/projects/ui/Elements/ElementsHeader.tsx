// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useShortcutKeyMap,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuBookmark,
  LuBookmarkPlus,
  LuBookOpenText,
  LuBoxes,
  LuChartGantt,
  LuChevronDown,
  LuFileText,
  LuGitPullRequestArrow,
  LuKanban,
  LuListTree,
  LuLock,
  LuNetwork,
  LuPlus,
  LuRefreshCw,
  LuSettings2,
  LuSheet,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link } from "react-router";
import { SearchFilter } from "~/components";
import {
  Boolean as BooleanField,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useUrlParams } from "~/hooks";
import type { ProjectViewsActionData } from "~/routes/x+/project+/$projectId.views";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import type {
  ProjectDisplayState,
  ProjectElementType,
  ProjectLayout
} from "../../projects.models";
import {
  projectElementTypes,
  projectLayouts,
  projectViewValidator
} from "../../projects.models";
import type { ActiveChangeRequest } from "../ChangeRequests/ChangeRequestBanner";
import { ChangeRequestPicker } from "../ChangeRequests/ChangeRequestPicker";
import type {
  ElementDisplay,
  ElementDisplayProperty,
  ElementGrouping
} from "./ElementProperties";
import {
  elementDisplayProperties,
  elementGroupings,
  useElementDisplayLabels,
  useElementGroupingLabels
} from "./ElementProperties";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";

export const elementLayouts = projectLayouts;
export type ElementLayout = ProjectLayout;

/** A saved view the user can pick: their own, or one someone shared. */
export type ElementViewOption = {
  id: string;
  name: string;
  isShared: boolean;
  isOwn: boolean;
  state: ProjectDisplayState;
};

const layoutIcons: Record<ElementLayout, IconType> = {
  list: LuListTree,
  board: LuKanban,
  table: LuSheet,
  tree: LuNetwork,
  timeline: LuChartGantt,
  reader: LuBookOpenText
};

type ElementsHeaderProps = {
  count: number;
  layout: ElementLayout;
  type: ProjectElementType | null;
  filters: ColumnFilter[];
  display: ElementDisplay;
  onDisplayChange: (property: ElementDisplayProperty, shown: boolean) => void;
  /** Focuses the quick-add input, with a type or the current one. */
  onNew: (type?: ProjectElementType) => void;
  /** Opens Build from part. */
  onBuildFromPart: () => void;
  canCreate: boolean;
  /** The Table layout's grouping; the Display popover offers it when set. */
  grouping?: ElementGrouping;
  onGroupingChange?: (grouping: ElementGrouping) => void;
  /** The Reader's PDF, with the current filters; shown when set. */
  exportHref?: string;
  projectId: string;
  views: ElementViewOption[];
  activeViewId: string | null;
  /** The page's current state, which Save view and Update view store. */
  currentState: ProjectDisplayState;
  /** Applies a view, or leaves the active one when `null`. */
  onSelectView: (view: ElementViewOption | null) => void;
  /** A new view was saved from the current state. */
  onViewSaved: (id: string) => void;
  /**
   * Set while the plan is locked and no change request is open: the lock
   * message, and the change requests page that opens one.
   */
  planLock?: { message: string; changeRequestsHref: string } | null;
  /** The open change requests the picker lists. */
  changeRequests: ActiveChangeRequest[];
  /** The change request on screen (`?cr=`), else null for the live plan. */
  activeChangeRequest: ActiveChangeRequest | null;
};

export function ElementsHeader({
  count,
  layout,
  type,
  filters,
  display,
  onDisplayChange,
  onNew,
  onBuildFromPart,
  canCreate,
  grouping,
  onGroupingChange,
  exportHref,
  planLock,
  projectId,
  changeRequests,
  activeChangeRequest,
  views,
  activeViewId,
  currentState,
  onSelectView,
  onViewSaved
}: ElementsHeaderProps) {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();
  useShortcutKeyMap(
    [
      {
        shortcut: PROJECT_SHORTCUTS.create,
        action: (event) => {
          event.preventDefault();
          onNew();
        }
      }
    ],
    { disabled: !canCreate }
  );
  const typeLabels = useElementTypeLabels();
  const displayLabels = useElementDisplayLabels();
  const groupingLabels = useElementGroupingLabels();
  const layoutLabels: Record<ElementLayout, string> = {
    list: t`List`,
    board: t`Board`,
    table: t`Table`,
    tree: t`Tree`,
    timeline: t`Timeline`,
    reader: t`Reader`
  };
  const LayoutIcon = layoutIcons[layout];
  const hasFilters = params.getAll("filter").filter(Boolean).length > 0;

  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <HStack spacing={2} className="min-w-0 flex-1">
          <Heading size="h4" className="shrink-0">
            <Trans>Elements</Trans>
          </Heading>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {count}
          </Badge>
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-hide">
            <TypeButton
              isActive={type === null}
              onClick={() => setParams({ type: null, layout })}
            >
              <Trans>All</Trans>
            </TypeButton>
            {projectElementTypes.map((value) => (
              <TypeButton
                key={value}
                isActive={type === value}
                onClick={() => setParams({ type: value, layout })}
              >
                <ElementTypeIcon type={value} className="size-3.5" />
                {typeLabels[value]}
              </TypeButton>
            ))}
          </div>
        </HStack>

        <HStack spacing={2} className="shrink-0">
          {planLock && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <LuLock className="size-3.5" />
                    <Trans>Plan locked</Trans>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{planLock.message}</TooltipContent>
              </Tooltip>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuGitPullRequestArrow />}
                asChild
              >
                <Link to={planLock.changeRequestsHref}>
                  <Trans>Open Change Request</Trans>
                </Link>
              </Button>
            </>
          )}
          <SearchFilter param="search" size="sm" placeholder={t`Search`} />
          <ChangeRequestPicker
            projectId={projectId}
            changeRequests={changeRequests}
            active={activeChangeRequest}
          />
          <ElementViewsMenu
            projectId={projectId}
            views={views}
            activeViewId={activeViewId}
            currentState={currentState}
            onSelectView={onSelectView}
            onViewSaved={onViewSaved}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                leftIcon={<LayoutIcon />}
                rightIcon={<LuChevronDown />}
              >
                {layoutLabels[layout]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuRadioGroup
                value={layout}
                onValueChange={(next) => setParams({ layout: next })}
              >
                {elementLayouts.map((value) => {
                  const Icon = layoutIcons[value];
                  return (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <DropdownMenuIcon icon={<Icon />} />
                      {layoutLabels[value]}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {exportHref && (
            <Button variant="secondary" leftIcon={<LuFileText />} asChild>
              <a href={exportHref} target="_blank" rel="noreferrer">
                <Trans>Export PDF</Trans>
              </a>
            </Button>
          )}
          {!hasFilters && <Filter filters={filters} />}
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t`Display`}
                icon={<LuSettings2 />}
                variant="secondary"
              />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <VStack spacing={3}>
                {grouping && onGroupingChange && (
                  <>
                    <span className="text-xs font-medium text-muted-foreground">
                      <Trans>Group by</Trans>
                    </span>
                    <div className="w-full">
                      <Combobox
                        asButton
                        size="sm"
                        value={grouping}
                        options={elementGroupings.map((value) => ({
                          value,
                          label: groupingLabels[value]
                        }))}
                        onChange={(value) =>
                          onGroupingChange((value as ElementGrouping) || "none")
                        }
                      />
                    </div>
                  </>
                )}
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Shown properties</Trans>
                </span>
                <VStack spacing={2}>
                  {elementDisplayProperties.map((property) => (
                    <Switch
                      key={property}
                      variant="small"
                      label={displayLabels[property]}
                      checked={display[property]}
                      onCheckedChange={(checked) =>
                        onDisplayChange(property, checked)
                      }
                    />
                  ))}
                </VStack>
              </VStack>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                leftIcon={<LuPlus />}
                rightIcon={<LuChevronDown />}
                isDisabled={!canCreate}
              >
                <Trans>New</Trans>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {projectElementTypes.map((value) => (
                <DropdownMenuItem key={value} onClick={() => onNew(value)}>
                  <DropdownMenuIcon icon={<ElementTypeIcon type={value} />} />
                  {typeLabels[value]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onBuildFromPart}>
                <DropdownMenuIcon icon={<LuBoxes />} />
                <Trans>Build from part</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </div>
      {hasFilters && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
          <ActiveFilters filters={filters} />
        </div>
      )}
    </div>
  );
}

function TypeButton({
  isActive,
  onClick,
  children
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/**
 * The saved views of the Elements page: the user's own and the shared ones.
 * Picking one applies its layout, filters and display options.
 */
function ElementViewsMenu({
  projectId,
  views,
  activeViewId,
  currentState,
  onSelectView,
  onViewSaved
}: Pick<
  ElementsHeaderProps,
  | "projectId"
  | "views"
  | "activeViewId"
  | "currentState"
  | "onSelectView"
  | "onViewSaved"
>) {
  const { t } = useLingui();
  const [isSaving, setIsSaving] = useState(false);
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const ownViews = views.filter((view) => view.isOwn);
  const sharedViews = views.filter((view) => !view.isOwn);

  // The fetcher's form data is gone when it settles, so a delete is noted here.
  const deletedView = useRef(false);
  const fetcher = useAction<ProjectViewsActionData>({
    onSuccess: (data) => {
      if (data.message) toast.success(data.message);
      if (deletedView.current) onSelectView(null);
      deletedView.current = false;
    },
    onError: (data) => toast.error(data.message ?? t`Failed to save the view`)
  });
  const action = path.to.projectViews(projectId);

  const updateView = (view: ElementViewOption) => {
    const formData = new FormData();
    formData.set("intent", "upsertView");
    formData.set("id", view.id);
    formData.set("name", view.name);
    // A checkbox posts "on" when checked and nothing when not.
    if (view.isShared) formData.set("isShared", "on");
    formData.set("state", JSON.stringify(currentState));
    fetcher.submit(formData, { method: "post", action });
  };
  const deleteView = (view: ElementViewOption) => {
    deletedView.current = true;
    fetcher.submit(
      { intent: "deleteView", id: view.id },
      { method: "post", action }
    );
  };

  const viewItems = (list: ElementViewOption[]) =>
    list.map((view) => (
      <DropdownMenuRadioItem key={view.id} value={view.id}>
        <span className="truncate">{view.name}</span>
      </DropdownMenuRadioItem>
    ));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={activeView ? "active" : "secondary"}
            leftIcon={<LuBookmark />}
            rightIcon={<LuChevronDown />}
            className="max-w-48"
          >
            <span className="truncate">
              {activeView ? activeView.name : <Trans>Views</Trans>}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuRadioGroup
            value={activeViewId ?? ""}
            onValueChange={(id) => {
              const view = views.find((v) => v.id === id);
              if (view) onSelectView(view);
            }}
          >
            {views.length === 0 && (
              <DropdownMenuItem disabled>
                <Trans>No saved views</Trans>
              </DropdownMenuItem>
            )}
            {ownViews.length > 0 && (
              <DropdownMenuLabel>
                <Trans>My views</Trans>
              </DropdownMenuLabel>
            )}
            {viewItems(ownViews)}
            {sharedViews.length > 0 && (
              <DropdownMenuLabel>
                <Trans>Shared views</Trans>
              </DropdownMenuLabel>
            )}
            {viewItems(sharedViews)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsSaving(true)}>
            <DropdownMenuIcon icon={<LuBookmarkPlus />} />
            <Trans>Save view</Trans>
          </DropdownMenuItem>
          {activeView?.isOwn && (
            <>
              <DropdownMenuItem onClick={() => updateView(activeView)}>
                <DropdownMenuIcon icon={<LuRefreshCw />} />
                <Trans>Update view</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                onClick={() => deleteView(activeView)}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete view</Trans>
              </DropdownMenuItem>
            </>
          )}
          {activeView && (
            <DropdownMenuItem onClick={() => onSelectView(null)}>
              <DropdownMenuIcon icon={<LuX />} />
              <Trans>Leave view</Trans>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {isSaving && (
        <SaveViewModal
          projectId={projectId}
          currentState={currentState}
          onClose={() => setIsSaving(false)}
          onSaved={(id) => {
            setIsSaving(false);
            onViewSaved(id);
          }}
        />
      )}
    </>
  );
}

function SaveViewModal({
  projectId,
  currentState,
  onClose,
  onSaved
}: {
  projectId: string;
  currentState: ProjectDisplayState;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<ProjectViewsActionData>({
    onSuccess: (data) => {
      if (data.id) onSaved(data.id);
    },
    onError: (data) => toast.error(data.message ?? t`Failed to save the view`)
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={projectViewValidator}
          method="post"
          action={path.to.projectViews(projectId)}
          fetcher={fetcher}
          defaultValues={{
            name: "",
            isShared: false,
            state: JSON.stringify(currentState)
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Save view</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="upsertView" />
            <Hidden name="state" />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} autoFocus />
              <BooleanField
                name="isShared"
                label={t`Shared`}
                description={t`Everyone who can see this project can use the view`}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
