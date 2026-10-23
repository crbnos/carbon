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
import type { ProjectElementType } from "../../projects.models";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { useElementRoutes } from "../Elements/ElementRoutes";
import {
  ElementTypeIcon,
  useElementTypeLabels
} from "../Elements/ElementTypeIcon";

/**
 * A one-line form that creates an element: type, name, Enter. The element
 * page's Children section uses it to add a child; Escape on an empty name
 * calls `onCancel`.
 */
export function QuickAddRow({
  projectId,
  type,
  onTypeChange,
  parent,
  stateId,
  inputRef,
  onCancel,
  className
}: {
  projectId: string;
  type: ProjectElementType;
  onTypeChange?: (type: ProjectElementType) => void;
  parent?: { id: string } | null;
  /** The state of the new element; empty takes the default Unstarted state. */
  stateId?: string;
  inputRef?: RefObject<HTMLInputElement>;
  onCancel?: () => void;
  className?: string;
}) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const changeRequestId = useActiveChangeRequestId();
  const routes = useElementRoutes(projectId);
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
      action: withChangeRequest(routes.create, changeRequestId)
    });
  };

  return (
    <form
      className={cn("flex h-9 shrink-0 items-center gap-2", className)}
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
          {routes.types.map((value) => (
            <DropdownMenuItem key={value} onClick={() => onTypeChange?.(value)}>
              <DropdownMenuIcon icon={<ElementTypeIcon type={value} />} />
              {typeLabels[value]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Input
        ref={inputRef}
        size="sm"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !name) onCancel?.();
        }}
        placeholder={t`Name the new element, then press Enter`}
        aria-label={t`New element name`}
        className="h-8 min-w-0 flex-1 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
        disabled={fetcher.isPending}
      />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        isLoading={fetcher.isPending}
        isDisabled={!name.trim() || fetcher.isPending}
      >
        <Trans>Add</Trans>
      </Button>
    </form>
  );
}
