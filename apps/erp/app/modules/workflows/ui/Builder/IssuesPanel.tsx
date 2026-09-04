import { IconButton } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuX } from "react-icons/lu";
import { useBuilderStoreShallow } from "./context";
import { IssueList } from "./IssueList";
import { selectAllIssues } from "./selectors";

export function IssuesPanel({ onDismiss }: { onDismiss: () => void }) {
  const issues = useBuilderStoreShallow(selectAllIssues);

  if (!issues.length) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 max-h-[40%] overflow-auto border-t bg-card shadow-lg">
      <div className="flex items-center justify-between border-b bg-destructive/5 px-3 py-2">
        <span className="text-[11.5px] font-semibold text-destructive">
          {issues.length === 1 ? (
            <Trans>1 problem — not published</Trans>
          ) : (
            <Trans>{issues.length} problems — not published</Trans>
          )}
        </span>
        <IconButton
          aria-label="Dismiss"
          variant="ghost"
          size="sm"
          icon={<LuX />}
          onClick={onDismiss}
        />
      </div>
      <IssueList issues={issues} />
    </div>
  );
}
