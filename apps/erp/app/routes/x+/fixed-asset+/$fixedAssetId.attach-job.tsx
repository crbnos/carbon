import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetAttachJobValidator,
  getFixedAsset,
  invokeAssetTransfer
} from "~/modules/accounting";
import { FixedAssetAttachJobForm } from "~/modules/accounting/ui/FixedAssets";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId);
  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  const assetClass = asset.data.fixedAssetClass as {
    isConstructionInProgress: boolean;
  } | null;

  if (
    !assetClass?.isConstructionInProgress ||
    (asset.data.status !== "Draft" &&
      asset.data.status !== "Under Construction")
  ) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(null, "A job can only be attached to an asset under construction")
      )
    );
  }

  // The jobs the function accepts: open, not for a sales order, and not
  // already building an asset. There is no production service for this
  // shape, so the filter lives here.
  const jobs = await client
    .from("job")
    .select("id, jobId, quantity, item:itemId(readableIdWithRevision, name)")
    .eq("companyId", companyId)
    .is("salesOrderLineId", null)
    .is("fixedAssetClassId", null)
    .is("fixedAssetId", null)
    .not("status", "in", "(Completed,Cancelled,Closed)")
    .order("jobId");

  if (jobs.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(jobs.error, "Failed to load jobs"))
    );
  }

  return {
    jobs: jobs.data.map((job) => {
      const item = job.item as {
        readableIdWithRevision: string | null;
        name: string;
      } | null;
      return {
        value: job.id,
        label: job.jobId,
        helper: item
          ? [item.readableIdWithRevision, item.name].filter(Boolean).join(" · ")
          : undefined
      };
    })
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(fixedAssetAttachJobValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await invokeAssetTransfer(client, {
    type: "attachJob",
    companyId,
    userId,
    fixedAssetId,
    jobId: validation.data.jobId
  });

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(
          result.error,
          await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to attach the job"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Job attached"))
  );
}

export default function AttachJobToFixedAssetRoute() {
  const { jobs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return <FixedAssetAttachJobForm jobs={jobs} onClose={() => navigate(-1)} />;
}
