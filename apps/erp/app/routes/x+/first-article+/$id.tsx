import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getFirstArticleCreateOptions,
  getFirstArticleInspection
} from "~/modules/quality";
import {
  FirstArticleCharacteristics,
  FirstArticleForm1,
  FirstArticleHeader,
  FirstArticleProducts
} from "~/modules/quality/ui/FirstArticles";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`First Articles`, to: path.to.firstArticles },
    (data) => data?.detail?.lot?.inspectionId
  ),
  module: "quality"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const detail = await getFirstArticleInspection(client, id, companyId);
  if (detail.error || !detail.data) {
    throw redirect(
      path.to.firstArticles,
      await flash(request, error(detail.error, "Failed to load first article"))
    );
  }

  // Baseline choices for a partial FAI: approved FAIs of any revision of this
  // part, other than this one. None once the job has been deleted.
  const jobId = detail.data.firstArticle.jobId;
  const options = jobId
    ? await getFirstArticleCreateOptions(client, jobId, companyId)
    : null;
  const readableId = detail.data.firstArticle.item?.readableId;
  const baselines = (options?.data?.baselines ?? []).filter(
    (baseline) => baseline.id !== id && baseline.readableId === readableId
  );

  return {
    detail: detail.data,
    baselines,
    currentUserId: userId
  };
}

export default function FirstArticleRoute() {
  const { detail, baselines, currentUserId } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
      <FirstArticleHeader detail={detail} currentUserId={currentUserId} />
      <div className="flex-1 overflow-y-auto bg-muted dark:bg-card">
        <VStack spacing={4} className="p-4 max-w-[96rem] mx-auto">
          <FirstArticleForm1
            key={`${detail.firstArticle.id}-${detail.firstArticle.updatedAt}`}
            detail={detail}
            baselines={baselines}
          />
          <FirstArticleProducts detail={detail} />
          <FirstArticleCharacteristics detail={detail} />
        </VStack>
      </div>
      <Outlet />
    </div>
  );
}
