// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { convertKbToString } from "@carbon/files";
import { useLoaderQuery } from "@carbon/query";
import { Button, Checkbox, Spinner } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import type { loader } from "~/routes/api+/purchasing.supplier-files";
import { path } from "~/utils/path";

type SupplierFilesPickerProps = {
  lines: { itemId: string | null; itemReadableId: string | null }[];
};

/**
 * The part files sent with an RFQ or supplier quote, all ticked. Each
 * unticked file goes in the form as `excludedFiles`.
 */
const SupplierFilesPicker = ({ lines }: SupplierFilesPickerProps) => {
  const itemIds = [
    ...new Set(lines.flatMap((line) => (line.itemId ? [line.itemId] : [])))
  ];
  const partByItem = new Map(
    lines.map((line) => [line.itemId, line.itemReadableId])
  );
  const query = useLoaderQuery<typeof loader>(
    itemIds.length > 0 ? path.to.api.supplierFiles(itemIds) : null
  );
  const [excluded, setExcluded] = useState<string[]>([]);

  if (itemIds.length === 0) return null;
  if (query.isError) {
    return (
      <div className="flex w-full items-center justify-between gap-2 text-sm text-muted-foreground">
        <Trans>Couldn't load the part files. All of them will be sent.</Trans>
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
  const included = files.filter((file) => !excluded.includes(file.path)).length;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">
          <Trans>Part files</Trans>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          <Trans>
            {included} of {files.length} included
          </Trans>
        </span>
      </div>
      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
        {files.map((file) => (
          <li key={file.path}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <Checkbox
                checked={!excluded.includes(file.path)}
                onCheckedChange={(checked) =>
                  setExcluded((current) =>
                    checked
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
                  ? convertKbToString(Math.floor(file.size / 1024))
                  : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {excluded.map((filePath, index) => (
        <input
          key={filePath}
          type="hidden"
          name={`excludedFiles[${index}]`}
          value={filePath}
        />
      ))}
    </div>
  );
};

export default SupplierFilesPicker;
