// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router";
import {
  elementSubtreeIds,
  getProjectElementCosts,
  getProjectLedger
} from "~/modules/projects";
import ProjectLedgerTable from "~/modules/projects/ui/Costs/ProjectLedgerTable";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "project-costs-element");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const elements = await getProjectElementCosts(client, projectId, companyId);
  if (elements.error) {
    logger.error("Failed to load project elements", {
      companyId,
      projectId,
      error: elements.error
    });
  }
  const elementRows = elements.data ?? [];
  const element = elementRows.find((row) => row.id === elementId);
  if (!element) {
    throw redirect(
      path.to.projectCosts(projectId),
      await flash(request, error(null, "The element does not exist"))
    );
  }

  const subtreeIds = elementSubtreeIds(elementRows, elementId);
  const subtree = new Set(subtreeIds);

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);
  const ledger = await getProjectLedger(client, companyId, {
    projectId,
    projectElementIds: subtreeIds,
    limit,
    offset,
    sorts,
    filters
  });
  if (ledger.error) {
    logger.error("Failed to load the project ledger", {
      companyId,
      projectId,
      elementId,
      error: ledger.error
    });
  }

  return {
    element: {
      readableId: element.readableId,
      name: element.name
    },
    elements: Object.fromEntries(
      elementRows
        .filter((row) => subtree.has(row.id))
        .map((row) => [row.id, { readableId: row.readableId, name: row.name }])
    ),
    ledger: ledger.data ?? [],
    count: ledger.count ?? 0
  };
}

export default function ProjectCostsElementRoute() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const { element, elements, ledger, count } = useLoaderData<typeof loader>();
  // With a filter set, the table stays: its filter is how the user clears it.
  const [searchParams] = useSearchParams();
  const isEmpty = count === 0 && !searchParams.has("filter");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.projectCosts(projectId));
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            <span className="mr-2 font-mono text-muted-foreground">
              {element.readableId}
            </span>
            {element.name}
          </DrawerTitle>
          <DrawerDescription>
            <Trans>Costs posted</Trans>
          </DrawerDescription>
        </DrawerHeader>
        {isEmpty ? (
          // One quiet line, not a full-height empty state.
          <DrawerBody>
            <p className="text-sm text-muted-foreground">
              <Trans>No costs have been posted to this element yet.</Trans>
            </p>
          </DrawerBody>
        ) : (
          <DrawerBody className="p-0">
            <ProjectLedgerTable
              data={ledger}
              count={count}
              elements={elements}
            />
          </DrawerBody>
        )}
      </DrawerContent>
    </Drawer>
  );
}
