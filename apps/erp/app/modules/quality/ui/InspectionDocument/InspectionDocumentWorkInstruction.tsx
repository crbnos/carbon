// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import type { JSONContent } from "@carbon/react";
import { generateHTML, useDebounce } from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useState } from "react";
import { useImageUpload } from "~/hooks";
import { path } from "~/utils/path";

/**
 * The plan's work instructions as typed in this editor. Saved on its own,
 * debounced (1 s, flushed when the editor unmounts), like the name: the
 * autosave carries the characteristics and balloons. Called by the editor,
 * not the tab, so switching tabs neither drops an unsaved edit nor flushes it.
 */
export function useWorkInstructionDraft(diagramId: string) {
  const workInstructionFetcher = useAction();
  // What was typed here, so switching tabs does not drop an unsaved edit.
  const [typedWorkInstruction, setTypedWorkInstruction] =
    useState<JSONContent | null>(null);
  // A typed work instruction waiting out its debounce, so Publish waits for
  // it rather than locking the version under it.
  const [workInstructionPending, setWorkInstructionPending] = useState(false);
  const debouncedSaveWorkInstruction = useDebounce(
    (content: JSONContent) => {
      setWorkInstructionPending(false);
      workInstructionFetcher.submit(
        { workInstruction: content },
        {
          method: "post",
          action: path.to.updateInspectionDocumentWorkInstruction(diagramId),
          encType: "application/json"
        }
      );
    },
    1000,
    true
  );

  const onChange = (content: JSONContent) => {
    setTypedWorkInstruction(content);
    setWorkInstructionPending(true);
    debouncedSaveWorkInstruction(content);
  };

  return {
    typedWorkInstruction,
    onChange,
    /** An edit waiting out its debounce or being saved. */
    isPending: workInstructionPending || workInstructionFetcher.state !== "idle"
  };
}

type InspectionDocumentWorkInstructionProps = {
  canUpdate: boolean;
  /** The saved work instruction, from the loader. */
  workInstruction: JSONContent | null;
  draft: ReturnType<typeof useWorkInstructionDraft>;
};

/** The Instructions tab: the editor on a Draft, the HTML on a locked version. */
export default function InspectionDocumentWorkInstruction({
  canUpdate,
  workInstruction,
  draft
}: InspectionDocumentWorkInstructionProps) {
  const onUploadImage = useImageUpload("inspection-documents");

  if (!canUpdate) {
    return (
      <div
        className="prose dark:prose-invert px-4 py-6"
        dangerouslySetInnerHTML={{
          __html: generateHTML(workInstruction ?? ({} as JSONContent))
        }}
      />
    );
  }

  return (
    <Editor
      key="instructions"
      initialValue={
        draft.typedWorkInstruction ?? workInstruction ?? ({} as JSONContent)
      }
      onUpload={onUploadImage}
      onChange={draft.onChange}
      // A toolbar flush with the pane's top and sides: pad the
      // text, not the editor around it.
      toolbar
      className="[&_.ProseMirror]:px-4 [&_.ProseMirror]:py-6"
    />
  );
}
