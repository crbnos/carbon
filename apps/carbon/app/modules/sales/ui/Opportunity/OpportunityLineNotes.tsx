import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  toast,
  useDebounce,
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { nanoid } from "nanoid";
import { useState } from "react";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

const OpportunityLineNotes = ({
  id,
  table,
  title,
  subTitle,
  notes: initialNotes,
}: {
  id: string | null;
  table: "salesRfqLine" | "quoteLine" | "salesOrderLine";
  title: string;
  subTitle: string;
  notes?: JSONContent;
}) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const [notes, setInternalNotes] = useState(initialNotes ?? {});

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/opportunity-line/${id}/${nanoid()}.${fileType}`;

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

  const onUpdateInternalNotes = useDebounce(async (content: JSONContent) => {
    await carbon
      ?.from(table)
      .update({
        [table === "salesRfqLine" ? "internalNotes" : "notes"]: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", id!);
  }, 2500);

  if (!id) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subTitle}</CardDescription>
        </CardHeader>

        <CardContent>
          {permissions.can("update", "sales") ? (
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
                __html: generateHTML(notes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default OpportunityLineNotes;
