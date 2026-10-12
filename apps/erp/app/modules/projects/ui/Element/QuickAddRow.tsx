// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useState } from "react";
import { LuCornerDownRight, LuX } from "react-icons/lu";
import { path } from "~/utils/path";
import type { ProjectElementType } from "../../projects.models";
import { projectElementTypes } from "../../projects.models";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import {
  ElementTypeIcon,
  useElementTypeLabels
} from "../Elements/ElementTypeIcon";

/**
 * A one-line form that creates an element: type, name, Enter. The element
 * page's Children section uses it to add a child.
 */
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
