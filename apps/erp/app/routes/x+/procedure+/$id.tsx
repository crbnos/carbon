import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { Input, toast, useDebounce } from "@carbon/react";
import { generateHTML, Editor } from "@carbon/react/Editor";
import { today, getLocalTimeZone } from "@internationalized/date";
import { Outlet, useFetcher, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { useState } from "react";
import { ResizablePanels , PanelProvider } from "~/components/Layout/Panels";
import { usePermissions, useUser } from "~/hooks";
import {
  getProcedure,
  getProcedureAttributes,
  getProcedureVersions,
} from "~/modules/production";
import ProcedureAttributesExplorer from "~/modules/production/ui/Procedures/ProcedureAttributesExplorer";
import ProcedureHeader from "~/modules/production/ui/Procedures/ProcedureHeader";
import ProcedureProperties from "~/modules/production/ui/Procedures/ProcedureProperties";
import type { action } from "~/routes/x+/procedure+/update";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Procedures",
  to: path.to.procedures,
  module: "production",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [procedure, attributes] = await Promise.all([
    getProcedure(client, id),
    getProcedureAttributes(client, id),
  ]);

  if (procedure.error) {
    throw redirect(
      path.to.procedures,
      await flash(request, error(procedure.error, "Failed to load procedure"))
    );
  }

  return defer({
    procedure: procedure.data,
    attributes: attributes.data,
    versions: getProcedureVersions(client, procedure.data, companyId),
  });
}

export default function ProcedureRoute() {
  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <ProcedureHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<ProcedureAttributesExplorer />}
              content={
                <div className="bg-background h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <ProcedureEditor />
                  <Outlet />
                </div>
              }
              properties={<ProcedureProperties />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}

function ProcedureEditor() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();

  const loaderData = useLoaderData<typeof loader>();

  const [procedureName, setProcedureName] = useState(
    loaderData?.procedure?.name ?? ""
  );

  const [content, setContent] = useState<JSONContent>(
    (loaderData?.procedure?.content ?? {}) as JSONContent
  );

  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  const updateProcedure = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("procedure")
        .update({
          content: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId,
        })
        .eq("id", id!);
    },
    500,
    true
  );

  const fetcher = useFetcher<typeof action>();

  const updateProcedureName = async (name: string) => {
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
      action: path.to.bulkUpdateProcedure,
    });
  };

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/job/notes/${nanoid()}.${fileType}`;

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
        value={procedureName}
        borderless
        onChange={
          loaderData?.procedure?.status === "Draft"
            ? (e) => setProcedureName(e.target.value)
            : undefined
        }
        onBlur={
          loaderData?.procedure?.status === "Draft"
            ? (e) => updateProcedureName(e.target.value)
            : undefined
        }
      />

      {permissions.can("update", "production") &&
      loaderData?.procedure?.status === "Draft" ? (
        <Editor
          initialValue={content}
          onUpload={onUploadImage}
          onChange={(value) => {
            setContent(value);
            updateProcedure(value);
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
