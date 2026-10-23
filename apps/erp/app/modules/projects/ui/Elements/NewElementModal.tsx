// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  toast
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Trans, useLingui } from "@lingui/react/macro";
import type { KeyboardEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { LuCheck, LuChevronRight, LuCornerDownRight } from "react-icons/lu";
import { useImageUpload } from "~/hooks";
import type {
  ProjectElementPriority,
  ProjectElementType
} from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectLabel, ProjectMilestone, ProjectState } from "../../types";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import {
  DateControl,
  defaultElementState,
  LabelsControl,
  MilestoneControl,
  NumberControl,
  OwnerControl,
  Pill,
  PriorityControl,
  StateControl
} from "./ElementProperties";
import { useElementRoutes } from "./ElementRoutes";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";

/** Where New element was opened from: the type, parent or state it starts with. */
export type NewElementDefaults = {
  type?: ProjectElementType;
  parentId?: string;
  stateId?: string;
};

type ParentOption = Pick<
  ProjectElementListItem,
  "id" | "readableId" | "name" | "type"
>;

function isEmptyDocument(content: JSONContent | null) {
  return !content?.content?.some(
    (node) => node.type !== "paragraph" || (node.content?.length ?? 0) > 0
  );
}

/**
 * Creates an element in one step, as Linear creates an issue: the title, the
 * description and every property chip before the first save, so the new
 * element needs no rework on its page. The type is the chip in the header.
 * With Create more on, the modal stays open for the next element and keeps
 * its properties.
 */
export function NewElementModal({
  projectId,
  context,
  elements,
  states,
  labels,
  milestones,
  types,
  defaults,
  onCreated,
  onClose
}: {
  projectId: string;
  /** The project's identifier, before the type (Linear's team). */
  context?: string;
  /** The elements a new one can sit under. */
  elements: ParentOption[];
  states: ProjectState[];
  labels: ProjectLabel[];
  /** The project's milestones; no Milestone chip without them. */
  milestones?: ProjectMilestone[];
  types: readonly ProjectElementType[];
  defaults: NewElementDefaults;
  onCreated: (
    created: { id: string; readableId: string },
    options: { createMore: boolean }
  ) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const routes = useElementRoutes(projectId);
  const changeRequestId = useActiveChangeRequestId();
  const typeLabels = useElementTypeLabels();
  const onUploadImage = useImageUpload("projects");
  const titleRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ProjectElementType>(
    defaults.type && types.includes(defaults.type) ? defaults.type : "Task"
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState<JSONContent | null>(null);
  // A new key clears the editor after Create more.
  const [editorKey, setEditorKey] = useState(0);
  const [parentId, setParentId] = useState<string | null>(
    defaults.parentId ?? null
  );
  const [stateId, setStateId] = useState(
    defaults.stateId ?? defaultElementState(states)?.id ?? ""
  );
  const [priority, setPriority] = useState<ProjectElementPriority>("None");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [estimatedHours, setEstimatedHours] = useState<number | null>(null);
  const [createMore, setCreateMore] = useState(false);

  const fetcher = useAction<{
    id?: string;
    readableId?: string;
    error?: { message: string };
  }>({
    onSuccess: (data) => {
      if (!data.id) return;
      const created = { id: data.id, readableId: data.readableId ?? "" };
      onCreated(created, { createMore });
      if (!createMore) {
        onClose();
        return;
      }
      toast.success(
        created.readableId
          ? t`Created ${created.readableId}`
          : t`Added to the change request`
      );
      setName("");
      setDescription(null);
      setEditorKey((key) => key + 1);
      titleRef.current?.focus();
    },
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to create the element`)
  });

  const typeLabel = typeLabels[type];
  const canSubmit = name.trim().length > 0 && !fetcher.isPending;
  const submit = () => {
    if (!canSubmit) return;
    const formData = new FormData();
    formData.append("type", type);
    formData.append("name", name.trim());
    if (parentId) formData.append("parentId", parentId);
    if (stateId) formData.append("stateId", stateId);
    formData.append("priority", priority);
    if (ownerId) formData.append("ownerId", ownerId);
    if (targetDate) formData.append("targetDate", targetDate);
    if (milestoneId) formData.append("milestoneId", milestoneId);
    if (estimatedHours !== null) {
      formData.append("estimatedHours", String(estimatedHours));
    }
    if (!isEmptyDocument(description)) {
      formData.append("description", JSON.stringify(description));
    }
    // Labels are live, not plan-layer: a change request takes none.
    if (!changeRequestId) {
      for (const id of labelIds) formData.append("labelIds", id);
    }
    fetcher.submit(formData, {
      method: "post",
      action: withChangeRequest(routes.create, changeRequestId)
    });
  };

  // ⌘↵ creates from anywhere in the modal; the title's own Enter has
  // already handled (and prevented) an Enter typed there.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  // A Parameter's children are Parameters; any other type sits under
  // anything but a Parameter.
  const parentOptions = useMemo(
    () =>
      elements.filter((e) => type === "Parameter" || e.type !== "Parameter"),
    [elements, type]
  );
  const changeType = (next: ProjectElementType) => {
    setType(next);
    const parent = elements.find((e) => e.id === parentId);
    if (next !== "Parameter" && parent?.type === "Parameter") {
      setParentId(null);
    }
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        size="xlarge"
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <ModalTitle className="sr-only">
          <Trans>New element</Trans>
        </ModalTitle>
        <div className="flex min-w-0 items-center gap-1.5 px-6 pr-14 max-md:px-4">
          {context && (
            <>
              <span className="inline-flex h-6 max-w-[12rem] shrink-0 items-center truncate rounded-md border border-border px-2 text-xs text-muted-foreground">
                {context}
              </span>
              <LuChevronRight className="size-3 shrink-0 text-muted-foreground" />
            </>
          )}
          <TypeControl value={type} onChange={changeType} types={types} />
          <span className="flex-1" />
        </div>
        <ModalBody className="mb-0">
          <input
            ref={titleRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            aria-label={t`Title`}
            placeholder={t`${typeLabel} title`}
            className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/70"
          />
          <Editor
            key={editorKey}
            // The title takes the focus, also after Create more remounts this.
            autoFocus={false}
            className="mt-2 min-h-24 [&_.ProseMirror]:text-sm"
            placeholder={t`Add a description…`}
            initialValue={{}}
            onUpload={onUploadImage}
            onChange={setDescription}
          />
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <StateControl
              variant="chip"
              value={stateId}
              onChange={setStateId}
              states={states}
            />
            <PriorityControl
              variant="chip"
              value={priority}
              onChange={setPriority}
            />
            <OwnerControl
              variant="chip"
              value={ownerId}
              onChange={setOwnerId}
            />
            {!changeRequestId && (
              <LabelsControl
                variant="chip"
                value={labelIds}
                onChange={setLabelIds}
                labels={labels}
              />
            )}
            <DateControl
              variant="chip"
              field="targetDate"
              value={targetDate}
              onChange={setTargetDate}
            />
            {type !== "Parameter" && (
              <NumberControl
                variant="chip"
                field="estimatedHours"
                value={estimatedHours}
                onChange={setEstimatedHours}
              />
            )}
            {milestones && (
              <MilestoneControl
                variant="chip"
                value={milestoneId}
                onChange={setMilestoneId}
                milestones={milestones}
              />
            )}
            <ParentControl
              value={parentId}
              onChange={setParentId}
              options={parentOptions}
            />
          </div>
        </ModalBody>
        <ModalFooter className="sm:items-center">
          <Switch
            variant="small"
            checked={createMore}
            onCheckedChange={setCreateMore}
            label={t`Create more`}
            className="sm:mr-auto"
          />
          <Button
            isLoading={fetcher.isPending}
            isDisabled={!canSubmit}
            onClick={submit}
          >
            <Trans>Create element</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/** The type chip in the header: the type picker. */
function TypeControl({
  value,
  onChange,
  types
}: {
  value: ProjectElementType;
  onChange: (value: ProjectElementType) => void;
  types: readonly ProjectElementType[];
}) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pill
          variant="chip"
          aria-label={t`Change type`}
          className="text-foreground"
        >
          <ElementTypeIcon type={value} className="size-3.5" />
          <span className="truncate">{typeLabels[value]}</span>
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as ProjectElementType)}
        >
          {types.map((type) => (
            <DropdownMenuRadioItem key={type} value={type}>
              <DropdownMenuIcon icon={<ElementTypeIcon type={type} />} />
              <span>{typeLabels[type]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The parent chip: the element the new one sits under, or the top level. */
function ParentControl({
  value,
  onChange,
  options
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ParentOption[];
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const parent = options.find((e) => e.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill variant="chip" aria-label={t`Change parent`}>
          <LuCornerDownRight className="size-3 shrink-0" />
          {parent ? (
            <span className="truncate">
              <span className="tabular-nums">{parent.readableId}</span>{" "}
              {parent.name}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">
              <Trans>Parent</Trans>
            </span>
          )}
        </Pill>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t`Search...`} className="h-9" />
          <CommandList>
            <CommandEmpty>
              <Trans>No option found.</Trans>
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={t`Top level`}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Trans>Top level</Trans>
                <LuCheck
                  className={cn(
                    "ml-auto size-4",
                    value === null ? "opacity-100" : "opacity-0"
                  )}
                />
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.readableId} ${option.name}`}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <DropdownMenuIcon
                    icon={<ElementTypeIcon type={option.type} />}
                  />
                  <span className="mr-2 shrink-0 text-muted-foreground tabular-nums">
                    {option.readableId}
                  </span>
                  <span className="truncate">{option.name}</span>
                  <LuCheck
                    className={cn(
                      "ml-auto size-4 shrink-0",
                      option.id === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
