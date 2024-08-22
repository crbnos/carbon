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
import { useSupabase } from "~/lib/supabase";
import type { SalesRFQLine } from "~/modules/sales";

const SalesRFQLineNotes = ({ line }: { line: SalesRFQLine }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const permissions = usePermissions();
  const { supabase } = useSupabase();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/sales-rfq-line/${
      line.id
    }/${nanoid()}.${fileType}`;
    const result = await supabase?.storage
      .from("private")
      .upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return `/file/preview/private/${result.data.path}`;
  };

  const onUpdateInternalNotes = useThrottle(async (content: JSONContent) => {
    await supabase
      ?.from("salesRfqLine")
      .update({
        internalNotes: content,
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
            initialValue={(line.internalNotes ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={onUpdateInternalNotes}
          />
        ) : (
          <div
            className="prose dark:prose-invert"
            dangerouslySetInnerHTML={{
              __html: generateHTML(line.internalNotes as JSONContent),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default SalesRFQLineNotes;
