// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import { path } from "~/utils/path";

type StockOwnerProps = {
  /** The owning project; null is common stock. */
  project?: { id: string; identifier: string | null; name: string } | null;
};

/** A stock owner: the project's identifier, linked, or "Common stock". */
export function StockOwner({ project }: StockOwnerProps) {
  if (!project) {
    return (
      <span className="text-muted-foreground">
        <Trans>Common stock</Trans>
      </span>
    );
  }
  return (
    <Hyperlink to={path.to.project(project.id)}>
      <span className="whitespace-nowrap">
        {project.identifier || project.name}
      </span>
    </Hyperlink>
  );
}

/** The owner options of a picker: common stock first, then each project. */
export function stockOwnerOptions(
  projects: { id: string; identifier: string | null; name: string }[],
  commonLabel: string
) {
  return [
    { value: "common", label: commonLabel },
    ...projects.map((project) => ({
      value: project.id,
      label: project.identifier
        ? `${project.identifier} — ${project.name}`
        : project.name
    }))
  ];
}
