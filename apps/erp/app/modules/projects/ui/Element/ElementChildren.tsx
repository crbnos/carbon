// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BarProgress } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useState } from "react";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { ProjectElementType } from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectState } from "../../types";
import { StatePill } from "../Elements/ElementProperties";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
import { QuickAddRow } from "./QuickAddRow";

/**
 * The direct children of an element: a progress bar (completed ÷ all), one
 * row per child, and a quick-add row that adds a child under this element.
 */
export function ElementChildren({
  projectId,
  identifier,
  parent,
  children,
  states,
  canUpdate,
  canCreate,
  quickAddRef
}: {
  projectId: string;
  identifier: string;
  parent: { id: string; readableId: string; type: ProjectElementType };
  children: ProjectElementListItem[];
  states: ProjectState[];
  canUpdate: boolean;
  canCreate: boolean;
  quickAddRef: RefObject<HTMLInputElement>;
}) {
  const { t } = useLingui();
  const [type, setType] = useState<ProjectElementType>("Task");
  const completed = children.filter(
    (child) => child.state?.group === "Completed"
  ).length;
  // A Parameter's children must be Parameters.
  const newType = parent.type === "Parameter" ? "Parameter" : type;

  return (
    <div className="flex w-full flex-col gap-2">
      {children.length > 0 && (
        <BarProgress
          progress={completed}
          max={children.length}
          label={t`Completed`}
          value={t`${completed} of ${children.length}`}
        />
      )}
      {children.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border">
          {children.map((child) => (
            <div
              key={child.id}
              className="flex h-10 items-center gap-2 border-b border-border/60 px-2 text-sm last:border-b-0 hover:bg-accent/40"
            >
              <Link
                to={path.to.projectElement(projectId, child.id)}
                className="flex min-w-0 flex-1 items-center gap-2 self-stretch"
              >
                <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {child.readableId}
                </span>
                <ElementTypeIcon type={child.type} />
                <span className="truncate">{child.name}</span>
              </Link>
              <StatePill
                projectId={projectId}
                elementId={child.id}
                stateId={child.stateId}
                states={states}
                isDisabled={!canUpdate}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          <Trans>No child elements</Trans>
        </p>
      )}
      {canCreate && (
        <QuickAddRow
          projectId={projectId}
          identifier={identifier}
          type={newType}
          onTypeChange={parent.type === "Parameter" ? undefined : setType}
          parent={{ id: parent.id, readableId: parent.readableId }}
          inputRef={quickAddRef}
          className="rounded-md border"
        />
      )}
    </div>
  );
}
