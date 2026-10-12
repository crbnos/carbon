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

const FixedAssetNotes = ({
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

  const onUploadImage = useImageUpload(`accounting/${id}`);

  const onUpdateNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("fixedAsset")
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
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {permissions.can("update", "accounting") ? (
          <Editor
            initialValue={(notes ?? {}) as JSONContent}
            onUpload={onUploadImage}
            onChange={(value) => {
              setNotes(value);
              onUpdateNotes(value);
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
  );
};

export default FixedAssetNotes;
