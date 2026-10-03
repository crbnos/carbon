// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { generateHTML, useDebounce } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useFetcher, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { useImageUpload, usePermissions, useUser } from "~/hooks";
import {
  getTraining,
  TrainingExplorer,
  TrainingHeader,
  TrainingProperties
} from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import type { action } from "~/routes/x+/training+/update";
import { useDocumentStore } from "~/stores";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "training-detail");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Training`, to: path.to.trainings },
    (data) => data?.training?.name
  ),
  module: "resources"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["id"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [training, tags] = await Promise.all([
    getTraining(client, id),
    getTagsList(client, companyId, "training")
  ]);

  if (training.error) {
    throw redirect(
      path.to.trainings,
      await flash(request, error(training.error, "Failed to load training"))
    );
  }

  // bypassRls makes `client` the service role, so the URL id is only proven to
  // exist — not to be this company's.
  if (training.data.companyId !== companyId) {
    logger.error("Training is not in the caller's company", {
      companyId,
      trainingId: id
    });
    throw redirect(path.to.trainings);
  }

  return {
    training: training.data,
    tags: tags.data ?? []
  };
}

export default function TrainingRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider key={id}>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <TrainingHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<TrainingExplorer key={`explorer-${id}`} />}
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <TrainingEditor />
                  <Outlet />
                </div>
              }
              properties={<TrainingProperties key={`properties-${id}`} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function TrainingEditor() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { t } = useLingui();
  const permissions = usePermissions();

  const loaderData = useLoaderData<typeof loader>();

  const [trainingName, setTrainingName] = useState(
    loaderData?.training?.name ?? ""
  );

  const [content, setContent] = useState<JSONContent>(
    (loaderData?.training?.content ?? {}) as JSONContent
  );

  const { carbon } = useCarbon();
  const { id: userId } = useUser();

  const updateTraining = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("training")
        .update({
          content: content ?? {},
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", id!);
    },
    500,
    true
  );

  const fetcher = useFetcher<typeof action>();
  const setLiveTitle = useDocumentStore((s) => s.setLiveTitle);

  const updateTrainingName = useDebounce(
    async (name: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", "name");
      formData.append("value", name);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateTraining
      });
    },
    500,
    true
  );

  const onUploadImage = useImageUpload("training");

  const canEdit =
    permissions.can("update", "people") &&
    loaderData?.training?.status === "Draft";

  // Mirror the live title only while editing; clear it when editing ends (e.g.
  // a Draft→Active transition that doesn't remount the route) or on unmount, so
  // the header title bar can never show a stale edited title.
  useEffect(() => {
    if (!canEdit) setLiveTitle(null);
    return () => setLiveTitle(null);
  }, [canEdit, setLiveTitle]);

  return (
    <div className="flex flex-col w-full h-full">
      {canEdit ? (
        <Editor
          toolbar
          title={{
            value: trainingName,
            placeholder: t`Untitled`,
            onChange: (name) => {
              setTrainingName(name);
              setLiveTitle(name);
              updateTrainingName(name);
            }
          }}
          initialValue={content}
          onUpload={onUploadImage}
          onChange={(value) => {
            setContent(value);
            updateTraining(value);
          }}
        />
      ) : (
        <div className="flex flex-col gap-6 w-full h-full p-8">
          <h1 className="md:text-3xl text-2xl font-semibold leading-tight tracking-tight text-foreground">
            {trainingName}
          </h1>
          <div
            className="prose dark:prose-invert"
            dangerouslySetInnerHTML={{
              __html: generateHTML(content)
            }}
          />
        </div>
      )}
    </div>
  );
}
