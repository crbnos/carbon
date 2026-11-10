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
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { getOpenJobsMissingStorageUnit } from "~/modules/settings/settings.service";
import { JobsMissingStorageUnitTable } from "~/modules/settings/ui/StrictBackflush";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { pageInMemory } from "~/utils/query";

const logger = getLogger("erp", "settings-items");

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const jobs = await getOpenJobsMissingStorageUnit(
    getDatabaseClient(),
    companyId
  );
  if (jobs.error) {
    logger.error("Failed to read open jobs missing a storage unit", {
      companyId,
      error: jobs.error
    });
    // An empty table would read as "nothing to fix".
    throw redirect(
      path.to.itemsSettings,
      await flash(
        request,
        error(jobs.error, "Failed to load the open jobs missing a storage unit")
      )
    );
  }

  const page = pageInMemory(
    jobs.data ?? [],
    new URL(request.url).searchParams,
    (job) => [
      job.jobId,
      job.status,
      job.readableId,
      job.locationName,
      ...job.materials
    ]
  );
  return { jobs: page.rows, count: page.count };
}

export default function JobsMissingStorageUnitRoute() {
  const { jobs, count } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.itemsSettings);
      }}
    >
      <DrawerContent size="xl">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Open Jobs Missing a Storage Unit</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0 max-md:p-0">
          <JobsMissingStorageUnitTable data={jobs} count={count} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
