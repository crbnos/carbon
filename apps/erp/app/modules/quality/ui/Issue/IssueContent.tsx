import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  generateHTML,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useState } from "react";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

export function IssueContent({
  id,
  title,
  subTitle,
  content: initialContent,
  isDisabled
}: {
  id: string;
  title: string;
  subTitle: string;
  content: JSONContent;
  isDisabled: boolean;
}) {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const [content, setContent] = useState(initialContent ?? {});

  const onUploadImage = useImageUpload("parts");

  const onUpdateContent = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("nonConformance")
        .update({
          content: content,
          updatedBy: userId
        })
        .eq("id", id!);
    },
    2500,
    true
  );

  if (!id) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>

        <CardContent>
          {permissions.can("update", "quality") && !isDisabled ? (
            <Editor
              initialValue={(content ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={(value) => {
                setContent(value);
                onUpdateContent(value);
              }}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(content as JSONContent)
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
