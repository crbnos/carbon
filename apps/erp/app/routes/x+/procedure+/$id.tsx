import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Input, JSONContent, toast, useDebounce } from "@carbon/react";
import { generateHTML } from "@carbon/react/Editor";
import { Editor } from "@carbon/react/Editor";
import { today } from "@internationalized/date";
import { getLocalTimeZone } from "@internationalized/date";
import { Outlet, useFetcher, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import {
  getProcedure,
  getProcedureVersions,
  Procedure,
} from "~/modules/production";
import ProcedureProperties from "~/modules/production/ui/Procedures/ProcedureProperties";
import type { action } from "~/routes/x+/procedure+/update";
import { Handle } from "~/utils/handle";
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

  const procedure = await getProcedure(client, id);

  if (procedure.error) {
    throw redirect(
      path.to.procedures,
      await flash(request, error(procedure.error, "Failed to load procedure"))
    );
  }

  return defer({
    procedure: procedure.data,
    versions: getProcedureVersions(client, procedure.data.name, companyId),
  });
}

export default function ProcedureRoute() {
  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <div className="flex h-[calc(100dvh-49px)] w-full">
        <div className="flex h-full w-full overflow-y-auto scrollbar-hide">
          <ProcedureEditor />
          <Outlet />
        </div>
        <ProcedureProperties />
      </div>
    </div>
  );
}

function ProcedureEditor() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();

  const routeData = useRouteData<{
    procedure: Procedure;
  }>(path.to.procedure(id));

  const [procedureName, setProcedureName] = useState(
    routeData?.procedure?.name ?? ""
  );

  const [content, setContent] = useState<JSONContent>(
    (routeData?.procedure?.content ?? {}) as JSONContent
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
    300,
    true
  );

  const fetcher = useFetcher<typeof action>();

  const updateProcedureName = useDebounce(
    async (name: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", "name");

      formData.append("value", name);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateProcedure,
      });
    },
    2500,
    true
  );

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
        className="border-none px-0 outline-none md:text-3xl text-2xl font-semibold leading-none tracking-tight text-foreground ring-transparent focus:ring-transparent focus:ring-offset-0 focus-visible:ring-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        value={procedureName}
        onChange={(e) => {
          setProcedureName(e.target.value);
          updateProcedureName(e.target.value);
        }}
      />

      {permissions.can("update", "production") ? (
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
