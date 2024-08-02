import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  toast,
  useDebounce,
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { QuotationLine } from "~/modules/sales";

const QuoteLineNotes = ({ line }: { line: QuotationLine }) => {
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();
  const { supabase } = useSupabase();

  const onUploadImage = async (file: File) => {
    const fileName = `${companyId}/quote-line/${line.id}/${encodeURIComponent(
      file.name
    )}`;
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

  const onUpdateInternalNotes = useDebounce(async (content: JSONContent) => {
    await supabase
      ?.from("quoteLine")
      .update({
        notes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", line.id!);
  }, 3000);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <Editor
          initialValue={(line.notes ?? {}) as JSONContent}
          onUpload={onUploadImage}
          onChange={onUpdateInternalNotes}
        />
      </CardContent>
    </Card>
  );
};

export default QuoteLineNotes;
