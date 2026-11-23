// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { convertKbToString } from "@carbon/files";
import { useLoaderQuery } from "@carbon/query";
import { Button, Checkbox, Spinner } from "@carbon/react";
import { round } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useCompanySettings } from "~/hooks/useCompanySettings";
import type { loader } from "~/routes/api+/purchasing.supplier-files";
import { path } from "~/utils/path";

type SupplierFilesPickerProps = {
  lines: { itemId: string | null; itemReadableId: string | null }[];
  // Told while the list loads, so the dialog holds its send button until
  // the user has seen what will be shared.
  onLoadingChange?: (loading: boolean) => void;
};

/**
 * The part files an RFQ or supplier quote can be sent with. They start ticked
 * when the company's `includeSupplierPartFiles` is on, unticked when off; each
 * ticked file goes in the form as `partFiles`, and only those are shared.
 * `partFilesListed` tells the send route the list was shown, so nothing
 * ticked is an explicit empty selection.
 */
const SupplierFilesPicker = ({
  lines,
  onLoadingChange
}: SupplierFilesPickerProps) => {
  const itemIds = [
    ...new Set(lines.flatMap((line) => (line.itemId ? [line.itemId] : [])))
  ];
  const partByItem = new Map(
    lines.map((line) => [line.itemId, line.itemReadableId])
  );
  const query = useLoaderQuery<typeof loader>(
    itemIds.length > 0 ? path.to.api.supplierFiles(itemIds) : null
  );
  const tickedByDefault =
    useCompanySettings()?.includeSupplierPartFiles ?? true;
  // The files the user flipped away from the default, so the default still
  // applies to a list that loads after the dialog opens.
  const [flipped, setFlipped] = useState<string[]>([]);
  const loading = itemIds.length > 0 && !query.data && !query.isError;
  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);
  const isTicked = (filePath: string) =>
    tickedByDefault !== flipped.includes(filePath);

  if (itemIds.length === 0) return null;
  if (query.isError) {
    return (
      <div className="flex w-full items-center justify-between gap-2 text-sm text-muted-foreground">
        <Trans>Couldn't load the part files, so none will be sent.</Trans>
        {/* Listed as an empty pick: the quote stops sharing its old files
            too, as the message says. */}
        <input type="hidden" name="partFilesListed" value="true" />
        <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="flex w-full items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3" />
        <Trans>Loading part files</Trans>
      </div>
    );
  }

  const files = query.data.files;
  if (files.length === 0) return null;
  const ticked = files.filter((file) => isTicked(file.path));

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">
          <Trans>Part files</Trans>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          <Trans>
            {ticked.length} of {files.length} included
          </Trans>
        </span>
      </div>
      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
        {files.map((file) => (
          <li key={file.path}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <Checkbox
                checked={isTicked(file.path)}
                onCheckedChange={() =>
                  setFlipped((current) =>
                    current.includes(file.path)
                      ? current.filter((path) => path !== file.path)
                      : [...current, file.path]
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate">{file.filename}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {partByItem.get(file.itemId)}
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {Number.isFinite(file.size)
                  ? convertKbToString(Math.max(1, round(file.size / 1024, 0)))
                  : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <input type="hidden" name="partFilesListed" value="true" />
      {ticked.map((file, index) => (
        <input
          key={file.path}
          type="hidden"
          name={`partFiles[${index}]`}
          value={file.path}
        />
      ))}
    </div>
  );
};

export default SupplierFilesPicker;
