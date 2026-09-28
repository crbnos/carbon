import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { createFirstArticleInspections } from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  firstArticleInspectionCreateValidator,
  getFirstArticleCreateOptions
} from "~/modules/quality";
import { seedFirstArticleProducts } from "~/modules/quality/firstArticle.server";
import FirstArticleCreateForm from "~/modules/quality/ui/FirstArticles/FirstArticleCreateForm";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "first-article", "new");

export const handle: Handle = {
  breadcrumb: msg`First Articles`,
  to: path.to.firstArticles
};

// Jobs that can still take a first article — not finished or cancelled.
const OPEN_JOB_STATUSES = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused"
] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "quality"
  });

  const jobId = new URL(request.url).searchParams.get("jobId");

  const [jobs, options] = await Promise.all([
    client
      .from("job")
      .select("id, jobId, item(readableIdWithRevision)")
      .eq("companyId", companyId)
      .in("status", [...OPEN_JOB_STATUSES])
      .order("createdAt", { ascending: false })
      .limit(500),
    jobId
      ? getFirstArticleCreateOptions(client, jobId, companyId)
      : Promise.resolve({
          data: { makeMethods: [], baselines: [] },
          error: null
        })
  ]);

  if (jobs.error || options.error) {
    logger.error("Failed to load the new first article form", {
      error: jobs.error ?? options.error,
      jobId,
      companyId
    });
    throw redirect(
      path.to.firstArticles,
      await flash(
        request,
        error(jobs.error ?? options.error, "Failed to load jobs")
      )
    );
  }

  const jobOptions = (jobs.data ?? []).map((job) => ({
    id: job.id,
    label: [job.jobId, job.item?.readableIdWithRevision]
      .filter(Boolean)
      .join(" — ")
  }));
  // A job linked from its own page may already be past the open statuses.
  if (jobId && !jobOptions.some((job) => job.id === jobId)) {
    const job = await client
      .from("job")
      .select("id, jobId")
      .eq("id", jobId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (job.data)
      jobOptions.unshift({ id: job.data.id, label: job.data.jobId });
  }

  return {
    jobId: jobId ?? "",
    jobs: jobOptions,
    makeMethods: options.data?.makeMethods ?? [],
    baselines: options.data?.baselines ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(
    firstArticleInspectionCreateValidator
  ).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    jobId,
    jobMakeMethodId,
    scope,
    reason,
    baselineFirstArticleInspectionId,
    baselineReference
  } = validation.data;

  const db = getDatabaseClient();
  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  const created = await createFirstArticleInspections(db, {
    jobId,
    companyId,
    userId,
    today,
    only: {
      jobMakeMethodId,
      scope,
      reason,
      baselineFirstArticleInspectionId,
      baselineReference
    }
  });

  const id = created.data?.firstArticleInspectionIds[0];
  if (created.error || !id) {
    logger.error("Failed to create a first article", {
      error: created.error,
      jobId,
      jobMakeMethodId,
      companyId
    });
    // "Assign a first article plan for …" — point at the part's plan slots.
    const needsPlan = created.error?.message?.startsWith(
      "Assign a first article plan"
    );
    const part = needsPlan
      ? await client
          .from("jobMakeMethod")
          .select("itemId")
          .eq("id", jobMakeMethodId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null;
    if (part?.data?.itemId) {
      throw redirect(
        path.to.partQuality(part.data.itemId),
        await flash(
          request,
          error(created.error, created.error?.message ?? "Assign a plan")
        )
      );
    }
    return data(
      {},
      await flash(
        request,
        error(created.error, "Failed to create the first article")
      )
    );
  }

  // Form 2 from traceability — best-effort; "Refresh from traceability" on the
  // FAI retries it.
  const seeded = await seedFirstArticleProducts(db, client, {
    id,
    companyId,
    userId
  });
  if (seeded.error) {
    logger.error("Failed to seed first article Form 2", {
      error: seeded.error,
      firstArticleInspectionId: id,
      companyId
    });
  }

  throw redirect(
    path.to.firstArticle(id),
    await flash(request, success("First article created"))
  );
}

export default function NewFirstArticleRoute() {
  const { jobId, jobs, makeMethods, baselines } =
    useLoaderData<typeof loader>();

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <FirstArticleCreateForm
        key={jobId}
        initialValues={{
          jobId,
          jobMakeMethodId: makeMethods[0]?.id ?? "",
          scope: "Full",
          reason: "New Part",
          baselineFirstArticleInspectionId: undefined,
          baselineReference: undefined
        }}
        jobs={jobs}
        makeMethods={makeMethods}
        baselines={baselines}
      />
    </div>
  );
}
