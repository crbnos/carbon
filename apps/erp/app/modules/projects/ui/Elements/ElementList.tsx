// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Checkbox,
  Combobox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useShortcutKeyMap
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useMemo, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuCopy,
  LuCornerDownRight,
  LuEllipsis,
  LuFolderInput,
  LuMaximize2,
  LuPlus,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link, useFetcher, useLocation, useParams } from "react-router";
import { Empty } from "~/components";
import { DiffBadge } from "~/components/Diff";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { PROJECT_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import type {
  ChangeOperationMark,
  ProjectElementPriority,
  ProjectElementType,
  RequirementStatus
} from "../../projects.models";
import { buildElementTree, projectElementTypes } from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectLabel, ProjectMilestone, ProjectState } from "../../types";
import {
  changeOperationStatus,
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { StateIcon } from "../Project/StateIcon";
import type { ElementDisplay, PillShortcutField } from "./ElementProperties";
import {
  ElementPriorityIcon,
  ElementProperties,
  PillShortcutProvider,
  StatePill,
  sortStates,
  usePillShortcutRequest,
  usePriorityLabels
} from "./ElementProperties";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";
import { SuspectBadge, VerificationStatus } from "./VerificationStatus";

/** The diff badge of a row an open change request adds, changes or removes. */
function changeStatus(element: object) {
  return changeOperationStatus(
    (element as { changeOperation?: ChangeOperationMark }).changeOperation
  );
}

export type ElementLayoutProps = {
  projectId: string;
  identifier: string;
  elements: ProjectElementListItem[];
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  display: ElementDisplay;
  /** The actual cost of each element and its subtree. */
  actualByElement: Map<string, number>;
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
};

type ElementListProps = ElementLayoutProps & {
  /** By Requirement id, the rolled-up verification status. */
  requirementStatus?: Record<string, RequirementStatus>;
  /** Elements with a suspect trace link at either end. */
  suspectIds?: Set<string>;
  newType: ProjectElementType;
  onNewTypeChange: (type: ProjectElementType) => void;
  quickAddRef: RefObject<HTMLInputElement>;
  onCreateFirst: () => void;
};

const ROW_HEIGHT = 44;

export function ElementList({
  projectId,
  identifier,
  elements,
  states,
  labels,
  milestones,
  display,
  actualByElement,
  canUpdate,
  canCreate,
  canDelete,
  newType,
  onNewTypeChange,
  quickAddRef,
  onCreateFirst,
  requirementStatus,
  suspectIds
}: ElementListProps) {
  const { t } = useLingui();
  // Opening an element keeps the layout and filters in the URL.
  const { search } = useLocation();
  const changeRequestId = useActiveChangeRequestId();
  const { elementId: openElementId } = useParams();
  const parentRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState<ProjectElementListItem | null>(null);
  const [deleting, setDeleting] = useState<ProjectElementListItem | null>(null);

  const tree = useMemo(() => buildElementTree(elements), [elements]);
  const byId = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements]
  );
  // A selection can name an element that a filter or a delete removed.
  const selection = selected.filter((id) => byId.has(id));
  const parent = selection.length === 1 ? byId.get(selection[0]) : undefined;

  // With one row selected and no element open (the open element's page
  // answers then), s / a / p / l open that row's pill.
  const [pillRequest, setPillRequest] = usePillShortcutRequest();
  const openPill = (field: PillShortcutField) => (event: KeyboardEvent) => {
    if (!parent) return;
    event.preventDefault();
    setPillRequest({ elementId: parent.id, field });
  };
  useShortcutKeyMap(
    [
      { shortcut: PROJECT_SHORTCUTS.state, action: openPill("state") },
      { shortcut: PROJECT_SHORTCUTS.owner, action: openPill("owner") },
      { shortcut: PROJECT_SHORTCUTS.priority, action: openPill("priority") },
      { shortcut: PROJECT_SHORTCUTS.labels, action: openPill("labels") }
    ],
    { disabled: !parent || !!openElementId }
  );

  const { nodes, getTreeProps, getNodeProps, toggleExpandNode, virtualizer } =
    useTree<ProjectElementListItem, undefined>({
      tree,
      parentRef,
      estimatedRowHeight: () => ROW_HEIGHT,
      isEager: true
    });

  const toggleSelected = (id: string) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    );

  const addChild = (id: string) => {
    setSelected([id]);
    quickAddRef.current?.focus();
  };

  return (
    <PillShortcutProvider value={pillRequest}>
      <div className="flex h-full min-h-0 flex-col">
        {selection.length > 0 && (
          <SelectionBar
            projectId={projectId}
            ids={selection}
            states={states}
            canUpdate={canUpdate}
            onClear={() => setSelected([])}
          />
        )}
        {tree.length === 0 ? (
          <div className="flex-1">
            <Empty>
              {canCreate && (
                <Button leftIcon={<LuPlus />} onClick={onCreateFirst}>
                  <Trans>Create the first element</Trans>
                </Button>
              )}
            </Empty>
          </div>
        ) : (
          <TreeView<ProjectElementListItem>
            tree={tree}
            nodes={nodes}
            getTreeProps={getTreeProps}
            getNodeProps={getNodeProps}
            virtualizer={virtualizer}
            parentRef={parentRef}
            parentClassName="flex-1 min-h-0"
            renderNode={({ node, state }) => {
              const element = node.data;
              const isOpen = element.id === openElementId;
              const isChecked = selection.includes(element.id);
              return (
                <div
                  className={cn(
                    "@container group/row flex h-11 items-center gap-2 border-b border-border/60 pr-2 pl-2 text-sm",
                    isOpen || state.selected
                      ? "bg-accent/70"
                      : "hover:bg-accent/40"
                  )}
                >
                  <Checkbox
                    aria-label={t`Select ${element.readableId}`}
                    isChecked={isChecked}
                    onCheckedChange={() => toggleSelected(element.id)}
                    className={cn(
                      "shrink-0 transition-opacity",
                      isChecked
                        ? "opacity-100"
                        : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                    )}
                  />
                  <div className="flex h-11 shrink-0 items-center">
                    {Array.from({ length: node.level }).map((_, index) => (
                      <LevelLine
                        key={index}
                        isSelected={isOpen}
                        className="h-11"
                      />
                    ))}
                  </div>
                  <Link
                    to={`${path.to.projectElement(projectId, element.id)}${search}`}
                    tabIndex={-1}
                    className="flex shrink-0 items-center gap-2 self-stretch"
                  >
                    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {element.readableId || t`New`}
                    </span>
                    <ElementTypeIcon type={element.type} />
                  </Link>
                  {changeStatus(element) && (
                    <span className="shrink-0">
                      <DiffBadge status={changeStatus(element)!} />
                    </span>
                  )}
                  {node.hasChildren && (
                    <button
                      type="button"
                      aria-label={state.expanded ? t`Collapse` : t`Expand`}
                      className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
                      onClick={() => toggleExpandNode(node.id)}
                    >
                      {state.expanded ? (
                        <LuChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <LuChevronRight className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <Link
                    to={`${path.to.projectElement(projectId, element.id)}${search}`}
                    className="flex min-w-0 flex-1 items-center self-stretch"
                  >
                    <span className="truncate font-medium">{element.name}</span>
                  </Link>
                  {suspectIds?.has(element.id) && <SuspectBadge />}
                  {element.type === "Requirement" &&
                    requirementStatus?.[element.id] && (
                      <span className="shrink-0">
                        <VerificationStatus
                          status={requirementStatus[element.id]}
                          iconOnly
                        />
                      </span>
                    )}
                  <ElementProperties
                    projectId={projectId}
                    element={element}
                    display={display}
                    states={states}
                    labels={labels}
                    milestones={milestones}
                    actual={actualByElement.get(element.id) ?? 0}
                    isDisabled={!canUpdate}
                    className="hidden shrink-0 flex-nowrap justify-end @min-[40rem]:flex"
                  />
                  {display.state && (
                    <div className="shrink-0 @min-[40rem]:hidden">
                      <StatePill
                        projectId={projectId}
                        elementId={element.id}
                        stateId={element.stateId}
                        states={states}
                        isDisabled={!canUpdate}
                      />
                    </div>
                  )}
                  <ElementRowMenu
                    projectId={projectId}
                    element={element}
                    canUpdate={canUpdate}
                    canCreate={canCreate}
                    canDelete={canDelete}
                    onAddChild={() => addChild(element.id)}
                    onMove={() => setMoving(element)}
                    onDelete={() => setDeleting(element)}
                  />
                </div>
              );
            }}
          />
        )}
        {canCreate && (
          <QuickAddRow
            projectId={projectId}
            identifier={identifier}
            type={newType}
            onTypeChange={onNewTypeChange}
            parent={
              parent ? { id: parent.id, readableId: parent.readableId } : null
            }
            onClearParent={() => setSelected([])}
            inputRef={quickAddRef}
          />
        )}
        {moving && (
          <MoveElementModal
            projectId={projectId}
            element={moving}
            elements={elements}
            onClose={() => setMoving(null)}
          />
        )}
        {deleting && (
          <ConfirmDelete
            action={withChangeRequest(
              path.to.deleteProjectElement(projectId, deleting.id),
              changeRequestId
            )}
            name={deleting.readableId}
            text={t`Delete ${deleting.readableId} and every element below it? An element that has costs, time, a job or a purchase order line cannot be deleted.`}
            onCancel={() => setDeleting(null)}
            onSubmit={() => setDeleting(null)}
          />
        )}
      </div>
    </PillShortcutProvider>
  );
}

// --- Row menu -----------------------------------------------------------------

export function ElementRowMenu({
  projectId,
  element,
  canUpdate,
  canCreate,
  canDelete,
  onAddChild,
  onMove,
  onDelete
}: {
  projectId: string;
  element: { id: string; readableId: string; type: ProjectElementType };
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
  onAddChild?: () => void;
  onMove?: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`More options`}
          icon={<LuEllipsis />}
          variant="ghost"
          size="sm"
          className="shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link to={path.to.projectElementFull(projectId, element.id)}>
            <DropdownMenuIcon icon={<LuMaximize2 />} />
            <Trans>Open</Trans>
          </Link>
        </DropdownMenuItem>
        {onAddChild && (
          <DropdownMenuItem
            disabled={!canCreate || element.type === "Parameter"}
            onClick={onAddChild}
          >
            <DropdownMenuIcon icon={<LuCornerDownRight />} />
            <Trans>Add child</Trans>
          </DropdownMenuItem>
        )}
        {onMove && (
          <DropdownMenuItem disabled={!canUpdate} onClick={onMove}>
            <DropdownMenuIcon icon={<LuFolderInput />} />
            <Trans>Move to…</Trans>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard.writeText(element.readableId);
            toast.success(t`Copied ${element.readableId}`);
          }}
        >
          <DropdownMenuIcon icon={<LuCopy />} />
          <Trans>Copy id</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={!canDelete} onClick={onDelete}>
          <DropdownMenuIcon icon={<LuTrash />} />
          <Trans>Delete</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Quick add ----------------------------------------------------------------

export function QuickAddRow({
  projectId,
  identifier,
  type,
  onTypeChange,
  parent,
  onClearParent,
  stateId,
  inputRef,
  className
}: {
  projectId: string;
  identifier: string;
  type: ProjectElementType;
  onTypeChange?: (type: ProjectElementType) => void;
  parent?: { id: string; readableId: string } | null;
  onClearParent?: () => void;
  /** The state of the new element; empty takes the default Unstarted state. */
  stateId?: string;
  inputRef?: RefObject<HTMLInputElement>;
  className?: string;
}) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const changeRequestId = useActiveChangeRequestId();
  const [name, setName] = useState("");
  const fetcher = useAction<{ id?: string; error?: { message: string } }>({
    onSuccess: () => setName(""),
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to create the element`)
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || fetcher.isPending) return;
    const formData = new FormData();
    formData.append("type", type);
    formData.append("name", trimmed);
    if (parent) formData.append("parentId", parent.id);
    if (stateId) formData.append("stateId", stateId);
    fetcher.submit(formData, {
      method: "post",
      action: withChangeRequest(
        path.to.newProjectElement(projectId),
        changeRequestId
      )
    });
  };

  return (
    <form
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 border-t border-border bg-card px-2",
        className
      )}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`Element type: ${typeLabels[type]}`}
            icon={<ElementTypeIcon type={type} />}
            variant="ghost"
            size="sm"
            isDisabled={!onTypeChange}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {projectElementTypes.map((value) => (
            <DropdownMenuItem key={value} onClick={() => onTypeChange?.(value)}>
              <DropdownMenuIcon icon={<ElementTypeIcon type={value} />} />
              {typeLabels[value]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {identifier}-
      </span>
      {parent && (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border px-1.5 text-xs text-muted-foreground">
          <LuCornerDownRight className="size-3" />
          <span className="font-mono">{parent.readableId}</span>
          {onClearParent && (
            <button
              type="button"
              aria-label={t`Add at the top level`}
              onClick={onClearParent}
              className="rounded hover:text-foreground"
            >
              <LuX className="size-3" />
            </button>
          )}
        </span>
      )}
      <Input
        ref={inputRef}
        size="sm"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t`Name the new element, then press Enter`}
        aria-label={t`New element name`}
        className="h-8 min-w-0 flex-1 border-none bg-transparent shadow-none focus-visible:ring-0"
        disabled={fetcher.isPending}
      />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        isLoading={fetcher.isPending}
        isDisabled={!name.trim() || fetcher.isPending}
      >
        <Trans>Add</Trans>
      </Button>
    </form>
  );
}

// --- Selection ----------------------------------------------------------------

function SelectionBar({
  projectId,
  ids,
  states,
  canUpdate,
  onClear
}: {
  projectId: string;
  ids: string[];
  states: ProjectState[];
  canUpdate: boolean;
  onClear: () => void;
}) {
  const priorityLabels = usePriorityLabels();
  const changeRequestId = useActiveChangeRequestId();
  const fetcher = useFetcher<{ error?: { message: string } }>();
  const sorted = useMemo(() => sortStates(states), [states]);
  const update = (field: "stateId" | "priority", value: string) => {
    const formData = new FormData();
    for (const id of ids) formData.append("ids", id);
    formData.append("field", field);
    formData.append("value", value);
    fetcher.submit(formData, {
      method: "post",
      action: withChangeRequest(
        path.to.projectElementUpdate(projectId),
        changeRequestId
      )
    });
  };

  return (
    <HStack className="h-10 shrink-0 justify-between border-b border-border bg-muted/40 px-3">
      <span className="text-sm text-muted-foreground tabular-nums">
        <Trans>{ids.length} selected</Trans>
      </span>
      <HStack spacing={2}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              rightIcon={<LuChevronDown />}
              isDisabled={!canUpdate}
              isLoading={fetcher.state !== "idle"}
            >
              <Trans>Update</Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <Trans>Update</Trans>
            </DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>State</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {sorted.map((state) => (
                  <DropdownMenuItem
                    key={state.id}
                    onClick={() => update("stateId", state.id)}
                  >
                    <DropdownMenuIcon
                      icon={
                        <StateIcon group={state.group} color={state.color} />
                      }
                    />
                    {state.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Priority</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(Object.keys(priorityLabels) as ProjectElementPriority[]).map(
                  (priority) => (
                    <DropdownMenuItem
                      key={priority}
                      onClick={() => update("priority", priority)}
                    >
                      <DropdownMenuIcon
                        icon={<ElementPriorityIcon priority={priority} />}
                      />
                      {priorityLabels[priority]}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <Trans>Clear</Trans>
        </Button>
      </HStack>
    </HStack>
  );
}

// --- Move to… -----------------------------------------------------------------

const TOP_LEVEL = "__top__";

export function MoveElementModal({
  projectId,
  element,
  elements,
  onClose
}: {
  projectId: string;
  element: { id: string; readableId: string; parentId: string | null };
  elements: {
    id: string;
    readableId: string;
    name: string;
    type: ProjectElementType;
    parentId: string | null;
  }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const changeRequestId = useActiveChangeRequestId();
  const [target, setTarget] = useState<string>(element.parentId ?? TOP_LEVEL);
  const fetcher = useAction<{ success?: boolean }>({
    onSuccess: () => onClose()
  });

  // The element itself and its descendants cannot be its new parent.
  const options = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const e of elements) {
      if (!e.parentId) continue;
      childrenOf.set(e.parentId, [...(childrenOf.get(e.parentId) ?? []), e.id]);
    }
    const excluded = new Set<string>();
    const stack = [element.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (excluded.has(id)) continue;
      excluded.add(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return [
      { value: TOP_LEVEL, label: t`Top level` },
      ...elements
        .filter((e) => !excluded.has(e.id) && e.type !== "Parameter")
        .map((e) => ({
          value: e.id,
          label: `${e.readableId} ${e.name}`,
          keywords: `${e.readableId} ${e.name}`
        }))
    ];
  }, [elements, element.id, t]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Move {element.readableId}</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Combobox
            asButton
            value={target}
            options={options}
            onChange={(value) => setTarget(value || TOP_LEVEL)}
            placeholder={t`Choose the new parent`}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isLoading={fetcher.isPending}
            isDisabled={
              fetcher.isPending || target === (element.parentId ?? TOP_LEVEL)
            }
            onClick={() =>
              fetcher.submit(
                {
                  intent: "move",
                  elementId: element.id,
                  parentId: target === TOP_LEVEL ? "" : target
                },
                {
                  method: "post",
                  action: withChangeRequest(
                    path.to.projectElementMove(projectId),
                    changeRequestId
                  )
                }
              )
            }
          >
            <Trans>Move</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
