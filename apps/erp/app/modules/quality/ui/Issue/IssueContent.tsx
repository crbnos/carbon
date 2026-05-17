import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  generateHTML,
  toast,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getCompanyPrivateBucket } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

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

    const result = await carbon?.storage
      .from(getCompanyPrivateBucket(companyId))
      .upload(fileName, file);

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
          <CardDescription>{subTitle}</CardDescription>
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
