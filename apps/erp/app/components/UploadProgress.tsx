// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BarProgress, Button, cn } from "@carbon/react";
import { RoundingMode, round } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuCircleAlert, LuLoaderCircle } from "react-icons/lu";

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export type UploadProgressProps = {
  percent: number;
  uploaded: number;
  total: number;
  label: string;
  description: string;
  className?: string;
};

/**
 * Progress readout for a file upload (CAD models, backup archives) — the `BarProgress` visual
 * language shared with assembly-convert / backups. Chrome-less on purpose (no
 * card border/background) so it drops straight into whatever container is
 * uploading — the dashed dropzone, or an overlay on the 3D viewer.
 */
export function UploadProgress({
  percent,
  uploaded,
  total,
  label,
  description,
  className
}: UploadProgressProps) {
  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      <BarProgress
        progress={percent}
        max={100}
        label={label}
        value={`${Math.round(percent)}%`}
        activeClassName="bg-primary"
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LuLoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <span>
          {description} ·{" "}
          <span className="tabular-nums">
            {formatBytes(uploaded)} / {formatBytes(total)}
          </span>
        </span>
      </div>
    </div>
  );
}

export type InterruptedUploadNoticeProps = {
  name: string;
  percent: number;
  onDismiss: () => void;
  className?: string;
};

/**
 * An upload a reload cut off. The browser cannot read the file again until the
 * user picks it, so this says to drop it again; the upload then continues where
 * it stopped. Rendered inside a drop zone, so Dismiss stops its click from
 * opening the file picker.
 */
export function InterruptedUploadNotice({
  name,
  percent,
  onDismiss,
  className
}: InterruptedUploadNoticeProps) {
  // Down, so it never claims more than was sent.
  const stopped = round(percent, 0, RoundingMode.Down);
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-left text-xs text-muted-foreground",
        className
      )}
    >
      <LuCircleAlert className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <Trans>
          The upload of{" "}
          <span className="font-medium text-foreground">{name}</span> stopped at{" "}
          {stopped}%. Drop the same file again to continue.
        </Trans>
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
      >
        <Trans>Dismiss</Trans>
      </Button>
    </div>
  );
}
