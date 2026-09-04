import type { WorkflowNotice } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";

/** The prose for a `WorkflowNotice` — the package emits codes and params only, so
 * the copy lives here, Lingui-translated like every other builder string. */
export function useNoticeCopy() {
  const { t } = useLingui();
  return (
    notice: WorkflowNotice,
    appLabel: string,
    siblingLabel: string
  ): string =>
    notice.code === "LINKS_CONDITIONAL" && notice.params !== undefined
      ? t`Records will be plain text. Set ${siblingLabel} to ${notice.params.equals} (under Advanced) to turn them into links.`
      : t`Records here appear as plain text — ${appLabel} doesn't support links in this field.`;
}
