// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import { generateHTML, toast, useDebounce } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useImageUpload } from "~/hooks";

function isEmptyDocument(content: JSONContent | null) {
  return !content?.content || content.content.length === 0;
}

/**
 * One rich-text field of a service record (an asset's notes, an order's
 * problem or resolution, a visit's notes). It posts `intent=field`, the
 * field name and the document to `action` 2.5 s after the last keystroke,
 * and on unmount. Read-only, it renders the text, or `empty` when there is
 * none. Key it by the record's id so another record starts with its own text.
 */
export function ServiceRichText({
  action,
  field,
  value,
  isDisabled,
  empty
}: {
  action: string;
  field: string;
  value: Json | null;
  isDisabled: boolean;
  empty: ReactNode;
}) {
  const { t } = useLingui();
  const fetcher = useAction<{ error?: { message: string } | null }>({
    key: `${action}:${field}`,
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save`, {
        id: `${action}:${field}`
      })
  });
  const onUploadImage = useImageUpload("service");
  const content = (value ?? null) as JSONContent | null;

  const save = useDebounce(
    (next: JSONContent) =>
      fetcher.submit(
        { intent: "field", field, value: JSON.stringify(next) },
        { method: "post", action }
      ),
    2500,
    true
  );

  if (isDisabled) {
    return isEmptyDocument(content) ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : (
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: generateHTML(content ?? {}) }}
      />
    );
  }

  return (
    <Editor
      className="min-h-24 [&_.ProseMirror]:text-sm"
      initialValue={content ?? {}}
      onUpload={onUploadImage}
      onChange={save}
    />
  );
}
