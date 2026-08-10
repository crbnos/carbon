import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCheck, LuChevronDown, LuCirclePlus } from "react-icons/lu";
import { useNavigate } from "react-router";

type VersionMenuProps<T> = {
  versions: T[];
  currentVersionId: string;
  getKey: (version: T) => string;
  getHref: (version: T) => string;
  renderLabel: (version: T) => ReactNode;
  renderStatus?: (version: T) => ReactNode;
  label?: ReactNode;
  onNewVersion?: () => void;
  isNewVersionDisabled?: boolean;
};

export function VersionMenu<T>({
  versions,
  currentVersionId,
  getKey,
  getHref,
  renderLabel,
  renderStatus,
  label,
  onNewVersion,
  isNewVersionDisabled
}: VersionMenuProps<T>) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" rightIcon={<LuChevronDown />}>
          {label ?? <Trans>Versions</Trans>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {versions.map((version) => {
          const isCurrent = getKey(version) === currentVersionId;
          return (
            <DropdownMenuItem
              key={getKey(version)}
              onClick={() => navigate(getHref(version))}
              className="flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-2">
                <LuCheck className={cn(!isCurrent && "opacity-0")} />
                {renderLabel(version)}
              </div>
              {renderStatus?.(version)}
            </DropdownMenuItem>
          );
        })}
        {onNewVersion && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isNewVersionDisabled}
              onClick={onNewVersion}
            >
              <DropdownMenuIcon icon={<LuCirclePlus />} />
              <Trans>New Version</Trans>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
