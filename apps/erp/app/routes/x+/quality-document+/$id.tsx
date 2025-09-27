import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { Input, toast, useDebounce } from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Outlet, useFetcher, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { useState } from "react";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { usePermissions, useUser } from "~/hooks";
import {
  getQualityDocument,
  getQualityDocumentVersions,
} from "~/modules/quality";
import QualityDocumentExplorer from "~/modules/quality/ui/Documents/QualityDocumentExplorer";
import QualityDocumentHeader from "~/modules/quality/ui/Documents/QualityDocumentHeader";
import QualityDocumentProperties from "~/modules/quality/ui/Documents/QualityDocumentProperties";
import type { action } from "~/routes/x+/quality-document+/update";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Documents",
  to: path.to.qualityDocuments,
  module: "quality",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [document] = await Promise.all([getQualityDocument(client, id)]);

  if (document.error) {
    throw redirect(
      path.to.documents,
      await flash(request, error(document.error, "Failed to load document"))
    );
  }

  return defer({
    document: document.data,
    versions: getQualityDocumentVersions(client, document.data, companyId),
  });
}

export default function QualityDocumentRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { document } = useLoaderData<typeof loader>();

  return (
    <PanelProvider key={`${id}-${document.version}`}>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <QualityDocumentHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <QualityDocumentExplorer
                  key={`explorer-${id}-${document.version}`}
                />
              }
              content={
                <div className="bg-background h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <QualityDocumentEditor />
                  <Outlet />
                </div>
              }
              properties={
                <QualityDocumentProperties
                  key={`properties-${id}-${document.version}`}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function QualityDocumentEditor() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();

  const loaderData = useLoaderData<typeof loader>();

  const [documentName, setQualityDocumentName] = useState(
    loaderData?.document?.name ?? ""
  );

  const [content, setContent] = useState<JSONContent>(
    (loaderData?.document?.content ?? {}) as JSONContent
  );

  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const updateQualityDocument = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("qualityDocument")
        .update({
          content: content ?? {},
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId,
        })
        .eq("id", id!);
    },
    500,
    true
  );

  const fetcher = useFetcher<typeof action>();

  const updateQualityDocumentName = async (name: string) => {
    const formData = new FormData();

    const versions = await Promise.resolve(loaderData?.versions);

    formData.append("ids", id);
    if (Array.isArray(versions?.data) && versions.data.length > 0) {
      versions.data.forEach((version) => {
        formData.append("ids", version.id);
      });
    }
    formData.append("field", "name");
    formData.append("value", name);

    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateQualityDocument,
    });
  };

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

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
        value={documentName}
        borderless
        onChange={
          loaderData?.document?.status === "Draft"
            ? (e) => setQualityDocumentName(e.target.value)
            : undefined
        }
        onBlur={
          loaderData?.document?.status === "Draft"
            ? (e) => updateQualityDocumentName(e.target.value)
            : undefined
        }
      />

      {permissions.can("update", "quality") &&
      loaderData?.document?.status === "Draft" ? (
        <Editor
          initialValue={content}
          onUpload={onUploadImage}
          onChange={(value) => {
            setContent(value);
            updateQualityDocument(value);
          }}
        />
      ) : (
        <div
          className="prose dark:prose-invert"
          dangerouslySetInnerHTML={{
            __html: generateHTML(content),
          }}
        />
      )}
    </div>
  );
}
