import {
  BUILT_IN_SECTION_IDS,
  type HeaderOptions
} from "@carbon/documents/template";
import { useCallback } from "react";
import { useEditorStore } from "./context";

/** Synthetic selection id for the header's Logo child node in the block tree. */
export const HEADER_LOGO_ID = "__header_logo__";

/**
 * Read + edit the document header's layout config (logo + which fields show).
 * The config is live editor state (see the store's `headerConfig`); it persists
 * with the rest of the template on Save, so edits show in the preview instantly
 * and mark the template dirty. `section` resolves the referenced header section
 * (for its name / existence check).
 */
export function useHeaderConfig() {
  const section = useEditorStore((s) =>
    s.sections.find(
      (x) => x.id === (s.headerSectionId ?? BUILT_IN_SECTION_IDS.header)
    )
  );
  const config = useEditorStore((s) => s.headerConfig);
  const setHeaderConfig = useEditorStore((s) => s.setHeaderConfig);

  const patch = useCallback(
    (partial: Partial<HeaderOptions>) => setHeaderConfig(partial),
    [setHeaderConfig]
  );

  return { section, config, patch };
}
