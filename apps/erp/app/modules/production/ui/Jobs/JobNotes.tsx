// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RichTextView,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { useImageUpload, usePermissions, useUser } from "~/hooks";

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
  const { id: userId } = useUser();
  const { carbon } = useCarbon();
  const permissions = usePermissions();

  const [notes, setInternalNotes] = useState(initialNotes ?? {});

  const onUploadImage = useImageUpload("job/notes");

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
            <RichTextView
              content={notes as JSONContent}
              empty={<Trans>No notes</Trans>}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default JobNotes;
