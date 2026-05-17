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
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

const JobNotes = ({
  id,
  title,
  subTitle,
  notes: initialNotes,
  isReadOnly: isReadOnlyProp
}: {
  id: string | null;
  title: string;
  subTitle: string;
  notes?: JSONContent;
  isReadOnly?: boolean;
}) => {
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const { t } = useLingui();

  const [notes, setInternalNotes] = useState(initialNotes ?? {});

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/job/notes/${nanoid()}.${fileType}`;

    const result = await carbon?.storage
      .from(companyPrivateBucket)
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

  const onUpdateInternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("job")
        .update({
          notes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
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
          <CardTitle>
            <Trans>Notes</Trans>
          </CardTitle>
          <CardDescription>{subTitle}</CardDescription>
        </CardHeader>

        <CardContent>
          {!isReadOnlyProp && permissions.can("update", "production") ? (
            <Editor
              initialValue={(notes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={(value) => {
                setInternalNotes(value);
                onUpdateInternalNotes(value);
              }}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(notes as JSONContent)
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default JobNotes;
