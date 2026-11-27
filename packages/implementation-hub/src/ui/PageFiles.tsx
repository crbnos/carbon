// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The files on a card of a person's page. The app stores them (the package
// cannot reach the ERP's storage or routes), so it supplies `PageFiles`: the
// page's files, and how to upload, remove and open one. The person attaches
// files to the cards that ask for one, Carbon staff to any card.

import { Button, IconButton, toast } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { LuFile, LuPaperclip, LuTrash2 } from "react-icons/lu";
import {
  canRemovePageFile,
  filesByCard,
  formatFileSize,
  PAGE_FILE_ACCEPT,
  pageFileRefusal
} from "../logic/page-files";
import type { ImplementationFileRow } from "../types";
import { useIsInternal, usePeopleById, useUserId } from "./state";

export interface PageFiles {
  // The files on the page shown.
  files: ImplementationFileRow[];
  // The card an upload is running for, if any.
  uploading: string | null;
  upload: (cardId: string, files: File[]) => Promise<void>;
  remove: (file: ImplementationFileRow) => void;
  // Where the file opens or downloads.
  href: (file: ImplementationFileRow) => string;
}

const PageFilesContext = createContext<PageFiles | null>(null);

export const PageFilesProvider = PageFilesContext.Provider;

const NO_FILES: ImplementationFileRow[] = [];

// The page's files by card; empty when the app supplies none.
export function usePageFilesByCard(): Map<string, ImplementationFileRow[]> {
  const context = useContext(PageFilesContext);
  return useMemo(() => filesByCard(context?.files ?? NO_FILES), [context]);
}

export function CardFiles({
  cardId,
  canUpload
}: {
  cardId: string;
  canUpload: boolean;
}) {
  const { t, i18n } = useLingui();
  const context = useContext(PageFilesContext);
  const byCard = usePageFilesByCard();
  const peopleById = usePeopleById();
  const userId = useUserId();
  const isInternal = useIsInternal();
  const input = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!context) return null;
  const files = byCard.get(cardId) ?? NO_FILES;
  if (!canUpload && files.length === 0) return null;
  const uploading = context.uploading === cardId;

  const choose = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    const accepted = chosen.filter((file) => {
      const refusal = pageFileRefusal(file);
      if (refusal === "type") {
        toast.error(t`${file.name} is not a type of file the page takes`);
      } else if (refusal === "size") {
        toast.error(t`${file.name} is larger than 50 MB`);
      }
      return refusal === null;
    });
    if (input.current) input.current.value = "";
    if (accepted.length) void context.upload(cardId, accepted);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          <Trans>Files</Trans>
        </h3>
        {canUpload ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={PAGE_FILE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => choose(event.target.files)}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPaperclip />}
              isLoading={uploading}
              isDisabled={uploading}
              onClick={() => input.current?.click()}
            >
              <Trans>Attach files</Trans>
            </Button>
          </>
        ) : null}
      </div>
      {files.length ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {files.map((file) => {
            const by = peopleById.get(file.createdBy)?.name;
            const on = formatDate(
              file.createdAt.slice(0, 10),
              undefined,
              i18n.locale
            );
            const removable = canRemovePageFile(file, { userId, isInternal });
            return (
              <li
                key={file.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <LuFile
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <a
                    href={context.href(file)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium hover:underline"
                  >
                    {file.name}
                  </a>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatFileSize(file.size, i18n.locale)} ·{" "}
                    {by ? (
                      <Trans>
                        {by}, {on}
                      </Trans>
                    ) : (
                      on
                    )}
                  </span>
                </div>
                {removable ? (
                  confirming === file.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          context.remove(file);
                          setConfirming(null);
                        }}
                      >
                        <Trans>Remove</Trans>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirming(null)}
                      >
                        <Trans>Keep</Trans>
                      </Button>
                    </div>
                  ) : (
                    <IconButton
                      aria-label={t`Remove ${file.name}`}
                      icon={<LuTrash2 />}
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(file.id)}
                    />
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          <Trans>No files yet.</Trans>
        </p>
      )}
    </section>
  );
}
