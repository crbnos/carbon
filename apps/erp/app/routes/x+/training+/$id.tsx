import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { generateHTML, Input, toast, useDebounce } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getCompanyPrivateBucket } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { nanoid } from "nanoid";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useParams
} from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { usePermissions, useUser } from "~/hooks";
import {
  getTraining,
  TrainingExplorer,
  TrainingHeader,
  TrainingProperties
} from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import type { action } from "~/routes/x+/training+/update";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Training`,
  to: path.to.trainings,
  module: "resources"
};

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
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <TrainingHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<TrainingExplorer key={`explorer-${id}`} />}
              content={
                <div className="bg-background h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
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

  const permissions = usePermissions();

  const loaderData = useLoaderData<typeof loader>();

  const [trainingName, setTrainingName] = useState(
    loaderData?.training?.name ?? ""
  );

  const [content, setContent] = useState<JSONContent>(
    (loaderData?.training?.content ?? {}) as JSONContent
  );

  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();

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

  const updateTrainingName = async (name: string) => {
    const formData = new FormData();

    formData.append("ids", id);
    formData.append("field", "name");
    formData.append("value", name);

    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTraining
    });
  };

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/training/${nanoid()}.${fileType}`;

    const result = await carbon?.storage
      .from(getCompanyPrivateBucket(companyId))
      .upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  return (
    <div className="flex flex-col gap-6 w-full h-full p-6">
      <Input
        className="md:text-3xl text-2xl font-semibold leading-none tracking-tight text-foreground"
        value={trainingName}
        borderless
        onChange={
          loaderData?.training?.status === "Draft"
            ? (e) => setTrainingName(e.target.value)
            : undefined
        }
        onBlur={
          loaderData?.training?.status === "Draft"
            ? (e) => updateTrainingName(e.target.value)
            : undefined
        }
      />

      {permissions.can("update", "people") &&
      loaderData?.training?.status === "Draft" ? (
        <Editor
          initialValue={content}
          onUpload={onUploadImage}
          onChange={(value) => {
            setContent(value);
            updateTraining(value);
          }}
        />
      ) : (
        <div
          className="prose dark:prose-invert"
          dangerouslySetInnerHTML={{
            __html: generateHTML(content)
          }}
        />
      )}
    </div>
  );
}
