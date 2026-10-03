// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Heading,
  SidebarTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuArrowLeft, LuClipboardCheck, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { JobDag } from "~/components/JobDag";
import {
  getJobOperationDependencies,
  getJobOperations
} from "~/services/operations.service";
import { getFirstArticlePlansMissingForJob } from "~/services/quality.server";
import { getOpenFirstArticleInspectionsForJob } from "~/services/quality.service";
import { path } from "~/utils/path";

const logger = getLogger("mes", "job-dag");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  // Service-role reads below are keyed on jobId alone, so the job must be
  // verified as this company's before any of them run.
  const job = await serviceRole
    .from("job")
    .select("jobId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!job.data) {
    logger.warn("Job not found in company", {
      companyId,
      jobId,
      error: job.error
    });
    throw redirect(path.to.jobs);
  }

  const [operations, dependencies, firstArticles, firstArticlePlansMissing] =
    await Promise.all([
      getJobOperations(serviceRole, jobId),
      getJobOperationDependencies(serviceRole, jobId),
      getOpenFirstArticleInspectionsForJob(serviceRole, jobId, companyId),
      // Parts that need a first article but resolve no plan — the ERP release
      // blocker, which an MES auto-start skips. Warned about, never blocking.
      getFirstArticlePlansMissingForJob(serviceRole, { jobId, companyId })
    ]);

  return {
    readableId: job.data.jobId ?? jobId,
    operations: operations.data ?? [],
    dependencies: dependencies.data ?? [],
    firstArticles: (firstArticles.data ?? []).map((lot) => ({
      id: lot.id,
      inspectionId: lot.inspectionId,
      itemReadableId: lot.item?.readableId ?? lot.itemReadableId ?? null
    })),
    firstArticlePlansMissing
  };
}

export default function JobDagRoute() {
  const {
    readableId,
    operations,
    dependencies,
    firstArticles,
    firstArticlePlansMissing
  } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Link
            to={path.to.jobs}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <LuArrowLeft className="w-4 h-4" />
          </Link>
          <Heading size="h4">{readableId}</Heading>
        </div>
      </header>

      {firstArticles.length > 0 || firstArticlePlansMissing.length > 0 ? (
        <div className="flex flex-col gap-2 border-b bg-card px-4 py-3">
          {firstArticlePlansMissing.map(({ jobMakeMethodId, description }) => (
            <Alert key={jobMakeMethodId} variant="warning">
              <LuTriangleAlert />
              <AlertTitle>
                <Trans>First article plan missing for {description}</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  Tell quality — this part needs a first article, but no
                  inspection plan is assigned to it.
                </Trans>
              </AlertDescription>
            </Alert>
          ))}
          {firstArticles.map((firstArticle) => (
            <Alert key={firstArticle.id} variant="warning">
              <LuClipboardCheck />
              <AlertTitle>
                <Trans>
                  First article required for{" "}
                  {firstArticle.itemReadableId ?? firstArticle.inspectionId}
                </Trans>
              </AlertTitle>
              <AlertDescription>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span className="text-pretty tabular-nums">
                    {firstArticle.inspectionId}
                  </span>
                  <Button variant="secondary" asChild>
                    <Link to={path.to.firstArticle(firstArticle.id)}>
                      <Trans>Inspect</Trans>
                    </Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <main className="flex-1 overflow-hidden">
        <JobDag operations={operations} dependencies={dependencies} />
      </main>
    </div>
  );
}
