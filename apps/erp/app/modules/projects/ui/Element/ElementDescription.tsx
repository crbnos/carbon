// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { generateHTML, useDebounce } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useLingui } from "@lingui/react/macro";
import { useImageUpload } from "~/hooks";
import { useElementField } from "../Elements/ElementProperties";

function isEmptyDocument(content: JSONContent | null) {
  return !content?.content || content.content.length === 0;
}

/**
 * The element's description in the rich-text editor. It saves through the
 * update route (`field: "description"`) 2.5 s after the last keystroke, and
 * on unmount. The parent keys it by element id, so another element starts
 * with its own text.
 */
export function ElementDescription({
  projectId,
  elementId,
  description,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  description: Json | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { submit } = useElementField(projectId, elementId, "description");
  const onUploadImage = useImageUpload("projects");
  const content = (description ?? null) as JSONContent | null;

  const save = useDebounce(
    (value: JSONContent) => submit(JSON.stringify(value)),
    2500,
    true
  );

  if (isDisabled) {
    return isEmptyDocument(content) ? null : (
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: generateHTML(content ?? {}) }}
      />
    );
  }

  return (
    <Editor
      className="min-h-8 [&_.ProseMirror]:text-sm"
      placeholder={t`Add a description…`}
      initialValue={content ?? {}}
      onUpload={onUploadImage}
      onChange={save}
    />
  );
}
