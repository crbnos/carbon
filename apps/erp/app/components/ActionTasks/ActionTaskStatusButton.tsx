import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { IssueTaskStatusIcon } from "~/components/Icons";
import {
  type ActionTaskStatus,
  actionTaskStatusActions
} from "./ActionTaskCard";

const statuses = Object.keys(actionTaskStatusActions) as ActionTaskStatus[];

// Icon-only status control for an action-task card: the current status as an
// icon (with tooltip), opening a dropdown to jump to any status. Shared by
// Quality issues and Change Orders so both read identically — and it renders an
// icon, not the status word, so there's no text to truncate in the card footer.
export function ActionTaskStatusButton({
  status,
  onChange,
  isDisabled,
  className
}: {
  status: ActionTaskStatus;
  onChange: (next: ActionTaskStatus) => void;
  isDisabled?: boolean;
  className?: string;
}) {
  const { t } = useLingui();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          variant="ghost"
          className={className}
          aria-label={t`Change status`}
          icon={<IssueTaskStatusIcon status={status} />}
          isDisabled={isDisabled}
        />
      </DropdownMenuTrigger>
      {!isDisabled && (
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={status}
            onValueChange={(next) => onChange(next as ActionTaskStatus)}
          >
            {statuses.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                <DropdownMenuIcon icon={<IssueTaskStatusIcon status={s} />} />
                <span>{s}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
