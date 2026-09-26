import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dispositionInspection,
  reconcileInspectionSamplingPlans
} from "@carbon/database/quality";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { InspectionView } from "~/components/Inspection/InspectionView";
import { getDatabaseClient } from "~/services/database.server";
import { createInspectionRejectionIssue } from "~/services/quality.server";
import {
  getInspection,
  getInspectionViewData
} from "~/services/quality.service";
import type { Job } from "~/services/types";
import { path } from "~/utils/path";

const logger = getLogger("mes", "first-article");

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

// A First Article lot is verdict-only: the decision closes the lot and posts
// nothing. Partial needs more than one unit, and a First Article lot has one.
const firstArticleVerdictValidator = z.object({
  decision: z.enum(["Accept", "Reject"], { error: "Decision is required" }),
  createNcr: zfd.text(z.enum(["true", "false"]).optional()),
  nonConformanceTypeId: zfd.text(z.string().optional())
});

// Loads the lot for this company, refusing anything that is not a First
// Article lot — the route is reachable by URL, and the service-role read is by
// id alone.
async function getFirstArticleLot(
  serviceRole: ServiceRole,
  args: { inspectionId: string; companyId: string }
) {
  const result = await getInspection(serviceRole, args.inspectionId);
  const lot = result.data as any;
  if (
    result.error ||
    !lot ||
    lot.companyId !== args.companyId ||
    lot.sourceDocument !== "First Article" ||
    !lot.sourceDocumentId ||
    !lot.sourceDocumentLineId
  ) {
    logger.error("First article inspection not found", {
      inspectionId: args.inspectionId,
      companyId: args.companyId,
      sourceDocument: lot?.sourceDocument ?? null,
      error: result.error
    });
    throw new Response("Not found", { status: 404 });
  }
  return lot as typeof lot & {
    sourceDocumentId: string;
    sourceDocumentLineId: string;
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const { inspectionId } = params;
  if (!inspectionId) {
    logger.error("First article route called without an inspection id", {
      companyId
    });
    throw new Response("Not found", { status: 404 });
  }

  const serviceRole = await getCarbonServiceRole();
  const inspection = await getFirstArticleLot(serviceRole, {
    inspectionId,
    companyId
  });

  // The lot references its plan live: features added after generation get
  // their per-lot plan rows (n = 1 for First Article) resolved lazily.
  if (inspection.inspectionDocumentId) {
    await reconcileInspectionSamplingPlans(
      getDatabaseClient(),
      inspection.id,
      companyId
    );
  }

  const [job, viewData] = await Promise.all([
    serviceRole
      .from("jobs")
      .select("*, customer(name)")
      .eq("id", inspection.sourceDocumentId)
      .eq("companyId", companyId)
      .single(),
    getInspectionViewData(serviceRole, {
      inspection,
      jobMakeMethodId: inspection.sourceDocumentLineId,
      companyId
    })
  ]);

  if (job.error || !job.data) {
    logger.error("First article job not found", {
      inspectionId,
      companyId,
      jobId: inspection.sourceDocumentId,
      error: job.error
    });
    throw new Response("Not found", { status: 404 });
  }

  return {
    ...viewData,
    job: job.data as Job,
    inspection,
    jobId: job.data.id ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { inspectionId } = params;
  if (!inspectionId) {
    logger.error("First article verdict posted without an inspection id", {
      companyId
    });
    throw new Response("Not found", { status: 404 });
  }

  const formData = await request.formData();
  const validation = await validator(firstArticleVerdictValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }
  const { decision, createNcr, nonConformanceTypeId } = validation.data;

  const serviceRole = await getCarbonServiceRole();
  const lot = await getFirstArticleLot(serviceRole, {
    inspectionId,
    companyId
  });
  const returnTo = path.to.firstArticle(inspectionId);

  // One-shot: a second POST (double tap, second tablet) finds the lot closed
  // and stops before it could open a second NCR.
  const disposition = await dispositionInspection(getDatabaseClient(), {
    id: lot.id,
    decision,
    companyId,
    dispositionedBy: userId,
    requireOpen: true
  });
  if (disposition.error) {
    logger.error("Failed to disposition first article", {
      inspectionId,
      companyId,
      decision,
      error: disposition.error
    });
    throw redirect(
      returnTo,
      await flash(
        request,
        error(disposition.error, "Failed to disposition first article")
      )
    );
  }

  if (decision === "Reject" && createNcr === "true") {
    // An NCR is raised against an operation; a First Article lot belongs to
    // its make method, so the method's first operation stands in.
    const operation = await serviceRole
      .from("jobOperation")
      .select("id")
      .eq("jobMakeMethodId", lot.sourceDocumentLineId)
      .eq("companyId", companyId)
      .order("order", { ascending: true })
      .limit(1)
      .maybeSingle();

    const issue = operation.data
      ? await createInspectionRejectionIssue(serviceRole, {
          inspectionId: lot.id,
          companyId,
          userId,
          nonConformanceTypeId,
          jobOperationId: operation.data.id
        })
      : {
          error: operation.error,
          message: "The make method has no operation to raise the NCR against"
        };

    if (issue.error || issue.message) {
      logger.error("Failed to create first article NCR", {
        inspectionId,
        companyId,
        error: issue.error,
        message: issue.message
      });
      throw redirect(
        returnTo,
        await flash(
          request,
          error(
            issue.error,
            `First article rejected, but ${issue.message ?? "creating the NCR failed"}`
          )
        )
      );
    }
  }

  throw redirect(
    returnTo,
    await flash(
      request,
      success(
        decision === "Accept"
          ? "First article accepted"
          : "First article rejected"
      )
    )
  );
}

export default function FirstArticleRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <InspectionView
      {...data}
      operationId={null}
      operation={null}
      events={[]}
      productionQuantities={{ scrap: 0, production: 0, rework: 0 }}
      linkedSampleIds={[]}
      linkedProductionQuantity={0}
    />
  );
}
