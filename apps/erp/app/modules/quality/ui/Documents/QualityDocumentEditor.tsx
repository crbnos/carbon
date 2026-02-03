import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import { generateHTML, Input, toast, useDebounce } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useFetcher, useLoaderData, useParams } from "react-router";
import { usePermissions, useUser } from "~/hooks";
import type { loader } from "~/routes/x+/quality-document+/$id";
import type { action } from "~/routes/x+/quality-document+/update";
import { getPrivateUrl, path } from "~/utils/path";

export default function QualityDocumentEditor() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const permissions = usePermissions();
  const loaderData = useLoaderData<typeof loader>();

  const [documentName, setDocumentName] = useState(
    loaderData?.document?.name ?? ""
  );
  const [content, setContent] = useState<JSONContent>(
    (loaderData?.document?.content ?? {}) as JSONContent
  );

  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();

  const updateContent = useDebounce(
    async (next: JSONContent) => {
      await carbon
        ?.from("qualityDocument")
        .update({
          content: next ?? {},
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", id);
    },
    500,
    true
  );

  const nameFetcher = useFetcher<typeof action>();

  const updateName = async (name: string) => {
    const versions = await Promise.resolve(loaderData?.versions);
    const formData = new FormData();
    formData.append("ids", id);
    if (Array.isArray(versions?.data) && versions.data.length > 0) {
      for (const v of versions.data) formData.append("ids", v.id);
    }
    formData.append("field", "name");
    formData.append("value", name);
    nameFetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateQualityDocument
    });
  };

  const onUploadImage = async (file: File) => {
    const ext = file.name.split(".").pop();
    const storagePath = `${companyId}/parts/${nanoid()}.${ext}`;
    const result = await carbon?.storage
      .from("private")
      .upload(storagePath, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }
    if (!result?.data) throw new Error("Failed to upload image");
    return getPrivateUrl(result.data.path);
  };

  const isDraft = loaderData?.document?.status === "Draft";
  const canEdit = permissions.can("update", "quality") && isDraft;

  return (
    <div className="flex flex-col gap-6 w-full h-full p-6">
      <Input
        className="md:text-3xl text-2xl font-semibold leading-none tracking-tight text-foreground"
        value={documentName}
        borderless
        onChange={canEdit ? (e) => setDocumentName(e.target.value) : undefined}
        onBlur={canEdit ? (e) => updateName(e.target.value) : undefined}
      />
      {canEdit ? (
        <Editor
          initialValue={content}
          onUpload={onUploadImage}
          onChange={(value) => {
            setContent(value);
            updateContent(value);
          }}
        />
      ) : (
        <div
          className="prose dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: generateHTML(content) }}
        />
      )}
    </div>
  );
}
