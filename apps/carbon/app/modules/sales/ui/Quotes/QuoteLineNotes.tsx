import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  generateHTML,
  toast,
  useThrottle,
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { nanoid } from "nanoid";
import { usePermissions, useUser } from "~/hooks";
import type { QuotationLine } from "~/modules/sales";
import { getPrivateUrl } from "~/utils/path";

const QuoteLineNotes = ({ line }: { line: QuotationLine }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/opportunity/${
      line.id
    }/${nanoid()}.${fileType}`;
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

  const onUpdateInternalNotes = useThrottle(async (content: JSONContent) => {
    await carbon
      ?.from("quoteLine")
      .update({
        notes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", line.id!);
  }, 2500);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {permissions.can("update", "sales") ? (
          <Editor
            initialValue={(line.notes ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={onUpdateInternalNotes}
          />
        ) : (
          <div
            className="prose dark:prose-invert"
            dangerouslySetInnerHTML={{
              __html: generateHTML(line.notes as JSONContent),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default QuoteLineNotes;
