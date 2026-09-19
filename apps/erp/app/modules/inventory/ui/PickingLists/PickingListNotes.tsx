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

const PickingListNotes = ({
  id,
  notes: initialNotes
}: {
  id: string | null;
  notes?: JSONContent;
}) => {
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const [notes, setNotes] = useState(initialNotes ?? {});

  const onUploadImage = useImageUpload(`inventory/${id}`);

  const onUpdateNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("pickingList")
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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Picking List Notes</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {permissions.can("update", "inventory") ? (
          <Editor
            initialValue={(notes ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={(value) => {
              setNotes(value);
              onUpdateNotes(value);
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
  );
};

export default PickingListNotes;
