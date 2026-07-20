import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  generateHTML,
  toast,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

// The two rich-text columns on the changeOrder header (reasonForChange +
// description). Both are stored as JSON and read/written the same way; the
// debounced writer targets the matching column directly through the
// request-scoped supabase client (mirrors IssueContent). Rendered as full Cards
// on the top-level CO detail route; `embedded` drops the Card chrome for callers
// that supply their own frame.
export function ChangeOrderContentSection({
  id,
  title,
  field,
  content: initialContent,
  isDisabled,
  embedded = false
}: {
  id: string;
  title: string;
  field: "reasonForChange" | "description";
  content: JSONContent;
  isDisabled: boolean;
  // When true, render just the editor/prose with no Card chrome — the caller
  // (e.g. the accordion rail) supplies the title + frame.
  embedded?: boolean;
}) {
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();
  const { t } = useLingui();
  const permissions = usePermissions();

  const [content, setContent] = useState(initialContent ?? {});

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error(t`Failed to upload image`);
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onUpdateContent = useDebounce(
    async (value: JSONContent) => {
      await carbon
        ?.from("changeOrder")
        .update({
          [field]: value,
          updatedBy: userId
        })
        .eq("id", id);
    },
    2500,
    true
  );

  const body =
    permissions.can("update", "parts") && !isDisabled ? (
      <Editor
        className="[&_.ProseMirror]:text-sm"
        initialValue={(content ?? {}) as JSONContent}
        onUpload={onUploadImage}
        onChange={(value) => {
          setContent(value);
          onUpdateContent(value);
        }}
      />
    ) : (
      <div
        className="prose prose-sm dark:prose-invert"
        dangerouslySetInnerHTML={{
          __html: generateHTML(content as JSONContent)
        }}
      />
    );

  if (embedded) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

export function ChangeOrderContent({
  id,
  reasonForChange,
  description,
  isDisabled
}: {
  id: string;
  reasonForChange: JSONContent;
  description: JSONContent;
  isDisabled: boolean;
}) {
  const { t } = useLingui();

  if (!id) return null;

  return (
    <>
      <ChangeOrderContentSection
        key={`${id}-reason`}
        id={id}
        title={t`Reason for Change`}
        field="reasonForChange"
        content={reasonForChange}
        isDisabled={isDisabled}
      />
      <ChangeOrderContentSection
        key={`${id}-description`}
        id={id}
        title={t`Description of Change`}
        field="description"
        content={description}
        isDisabled={isDisabled}
      />
    </>
  );
}
