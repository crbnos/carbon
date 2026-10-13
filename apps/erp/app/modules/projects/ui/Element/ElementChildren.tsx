// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { path } from "~/utils/path";
import type {
  ProjectElementType,
  RequirementStatus
} from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectLabel, ProjectState } from "../../types";
import { ElementRow } from "../Elements/ElementList";
import { QuickAddRow } from "./QuickAddRow";

/**
 * The direct children of an element as the Plan list's rows, and an
 * "+ Add child" row at the end that opens a one-line form.
 */
export function ElementChildren({
  projectId,
  parent,
  children,
  states,
  labels,
  requirementStatus,
  canUpdate,
  canCreate,
  isAdding,
  onAddingChange,
  quickAddRef
}: {
  projectId: string;
  parent: { id: string; type: ProjectElementType };
  children: ProjectElementListItem[];
  states: ProjectState[];
  labels: ProjectLabel[];
  requirementStatus: Record<string, RequirementStatus>;
  canUpdate: boolean;
  canCreate: boolean;
  isAdding: boolean;
  onAddingChange: (adding: boolean) => void;
  quickAddRef: RefObject<HTMLInputElement>;
}) {
  const [type, setType] = useState<ProjectElementType>("Task");
  // A Parameter's children must be Parameters.
  const newType = parent.type === "Parameter" ? "Parameter" : type;
  const labelsById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels]
  );
  const idChars = Math.max(0, ...children.map((c) => c.readableId.length));

  return (
    <div className="-mx-3 flex flex-col">
      {children.map((child) => (
        <ElementRow
          key={child.id}
          projectId={projectId}
          element={child}
          states={states}
          labelsById={labelsById}
          requirementStatus={requirementStatus[child.id]}
          href={path.to.projectElement(projectId, child.id)}
          canUpdate={canUpdate}
          idChars={idChars}
          className="rounded-md px-3"
        />
      ))}
      {canCreate &&
        (isAdding ? (
          <QuickAddRow
            projectId={projectId}
            type={newType}
            onTypeChange={parent.type === "Parameter" ? undefined : setType}
            parent={{ id: parent.id }}
            inputRef={quickAddRef}
            onCancel={() => onAddingChange(false)}
            className="px-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              onAddingChange(true);
              requestAnimationFrame(() => quickAddRef.current?.focus());
            }}
            className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <LuPlus className="size-3.5" />
            <Trans>Add child</Trans>
          </button>
        ))}
    </div>
  );
}
