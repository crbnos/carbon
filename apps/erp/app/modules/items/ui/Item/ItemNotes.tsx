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
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

const ItemNotes = ({
  id,
  title,
  subTitle,
  notes: initialNotes
}: {
  id: string | null;
  title: string;
  subTitle: string;
  notes?: JSONContent;
}) => {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const [notes, setInternalNotes] = useState(initialNotes ?? {});

  const onUploadImage = useImageUpload("parts/notes");

  const onUpdateInternalNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("item")
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
        </CardHeader>

        <CardContent>
          {permissions.can("update", "parts") ? (
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

export default ItemNotes;
