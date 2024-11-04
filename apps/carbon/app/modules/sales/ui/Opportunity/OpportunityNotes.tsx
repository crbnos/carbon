import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  HStack,
  toast,
  useThrottle,
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { nanoid } from "nanoid";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl } from "~/utils/path";

const OpportunityNotes = ({
  id,
  table,
  internalNotes,
  externalNotes,
}: {
  id: string | null;
  table: "salesRfq" | "quote" | "salesOrder";
  internalNotes?: JSONContent;
  externalNotes?: JSONContent;
}) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/opportunity/${id}/${nanoid()}.${fileType}`;

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

  const onUpdateExternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from(table)
      .update({
        externalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", id!);
  }, 2500);

  const onUpdateInternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from(table)
      .update({
        internalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", id!);
  }, 2500);

  if (!id) return null;

  return (
    <HStack className="w-full justify-between items-stretch">
      <Card>
        <CardHeader>
          <CardTitle>External Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(externalNotes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={onUpdateExternalNotes}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(externalNotes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Internal Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {permissions.can("update", "sales") ? (
            <Editor
              initialValue={(internalNotes ?? {}) as JSONContent}
              onUpload={onUploadImage}
              onChange={onUpdateInternalNotes}
            />
          ) : (
            <div
              className="prose dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: generateHTML(internalNotes as JSONContent),
              }}
            />
          )}
        </CardContent>
      </Card>
    </HStack>
  );
};

export default OpportunityNotes;
