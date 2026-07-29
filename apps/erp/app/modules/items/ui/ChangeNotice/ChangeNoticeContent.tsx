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
import { useFetcher } from "react-router";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";

// The two rich-text columns on the changeOrder header (reasonForChange +
// description). Both are stored as JSON and read/written the same way; the
// debounced writer posts to $id.content so the engineering lock is enforced
// server-side (a direct supabase write had no such gate). Rendered as full Cards
// on the top-level CO detail route; `embedded` drops the Card chrome for callers
// that supply their own frame.
export function ChangeNoticeContentSection({
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
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

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
    (value: JSONContent) => {
      fetcher.submit(
        { field, content: JSON.stringify(value) },
        { method: "post", action: path.to.changeNoticeContent(id) }
      );
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

export function ChangeNoticeContent({
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
      <ChangeNoticeContentSection
        key={`${id}-reason`}
        id={id}
        title={t`Reason for Change`}
        field="reasonForChange"
        content={reasonForChange}
        isDisabled={isDisabled}
      />
      <ChangeNoticeContentSection
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
