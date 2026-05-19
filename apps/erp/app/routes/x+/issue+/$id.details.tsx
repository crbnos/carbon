import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles, Documents } from "~/components";
import { useRouteData } from "~/hooks";
import type { IssueAssociationNode } from "~/modules/quality";
import {
  getIssue,
  getIssueActionTasks,
  getIssueReviewers,
  isIssueLocked,
  issueValidator,
  upsertIssue
} from "~/modules/quality";
import {
  ActionTasksList,
  AssociatedItemsList,
  IssueContent,
  ReviewersList
} from "~/modules/quality/ui/Issue";
import type { StorageItem } from "~/types";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const nonConformance = await client
    .from("nonConformance")
    .select("*")
    .eq("id", id)
    .single();

  if (nonConformance.error) {
    throw new Error(nonConformance.error.message);
  }

  return {
    nonConformance: nonConformance.data,
    actionTasks: getIssueActionTasks(id),
    reviewers: getIssueReviewers(id)
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  await requirePermissions(request, {
    view: "quality"
  });
  const issue = await getIssue(id);
  await requireUnlocked({
    request,
    isLocked: isIssueLocked(issue.data?.status),
    redirectTo: path.to.issue(id),
    message: "Cannot modify a closed issue. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  if (!validation.data.nonConformanceId) {
    throw new Error("Could not find issue id");
  }

  const nonConformanceId = validation.data.nonConformanceId;
  if (!nonConformanceId) {
    throw new Error("Could not find issue id");
  }

  const updateIssue = await upsertIssue({
    ...validation.data,
    id: id,
    nonConformanceId: nonConformanceId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateIssue.error) {
    throw redirect(
      path.to.issue(id),
      await flash(request, error(updateIssue.error, "Failed to update issue"))
    );
  }

  throw redirect(
    path.to.issue(id),
    await flash(request, success("Updated issue"))
  );
}

export default function IssueDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { t } = useLingui();
  const { nonConformance, actionTasks, reviewers } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    files: Promise<StorageItem[]>;
    suppliers: { supplierId: string; externalLinkId: string | null }[];
    associations: Promise<{ items: IssueAssociationNode["children"] }>;
  }>(path.to.issue(id));

  if (!routeData) throw new Error("Could not find issue data");

  return (
    <VStack spacing={2}>
      <IssueContent
        id={id}
        title={t`Description of Issue`}
        subTitle={nonConformance?.name}
        content={nonConformance?.content as JSONContent}
        isDisabled={isIssueLocked(nonConformance?.status)}
      />

      <Suspense
        fallback={
          <div className="flex min-h-[420px] w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="size-10" />
          </div>
        }
      >
        <Await resolve={routeData?.associations}>
          {(resolvedAssociations) => (
            <AssociatedItemsList
              associatedItems={resolvedAssociations?.items ?? []}
              isDisabled={isIssueLocked(nonConformance?.status)}
            />
          )}
        </Await>
      </Suspense>

      <DeferredFiles resolve={routeData?.files}>
        {(resolvedFiles) => (
          <Documents
            files={resolvedFiles}
            sourceDocument="Issue"
            sourceDocumentId={id}
            writeBucket="parts"
            writeBucketPermission="parts"
          />
        )}
      </DeferredFiles>

      <Suspense
        fallback={
          <div className="flex min-h-[420px] w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="size-10" />
          </div>
        }
      >
        <Await resolve={actionTasks}>
          {(resolvedTasks) => (
            <ActionTasksList
              tasks={resolvedTasks?.data ?? []}
              suppliers={routeData?.suppliers ?? []}
              isDisabled={isIssueLocked(nonConformance?.status)}
            />
          )}
        </Await>
      </Suspense>

      <Suspense
        fallback={
          <div className="flex min-h-[420px] w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="size-10" />
          </div>
        }
      >
        <Await resolve={reviewers}>
          {(resolvedReviewers) => (
            <ReviewersList
              reviewers={resolvedReviewers?.data ?? []}
              isDisabled={isIssueLocked(nonConformance?.status)}
            />
          )}
        </Await>
      </Suspense>
    </VStack>
  );
}
