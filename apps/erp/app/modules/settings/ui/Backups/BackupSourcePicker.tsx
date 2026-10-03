// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { useControlField } from "@carbon/form";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  LuArchive,
  LuChevronsUpDown,
  LuLoaderCircle,
  LuUpload
} from "react-icons/lu";
import { useRevalidator } from "react-router";
import { UploadProgress } from "~/components/UploadProgress";
import { uploadToSignedUrlWithProgress } from "~/utils/signed-upload";
import { formatBackupDate, formatBackupName } from "./format";

// The archive's bytes, then the server unpacking it (no byte progress there).
type UploadState =
  | { phase: "uploading"; uploaded: number; total: number }
  | { phase: "unpacking" };

const triggerClass =
  "bg-transparent text-foreground flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input px-3 py-2 text-sm shadow-xs outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

// One control combining your backups + upload new. Selecting one sets the
// hidden `source` field the restore form submits.
export function BackupSourcePicker({
  backups
}: {
  backups: { name: string; label: string | null; exportedAt: string | null }[];
}) {
  const { t } = useLingui();
  const revalidator = useRevalidator();
  const [value, setValue] = useControlField<string>("source");
  const [open, setOpen] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const uploading = upload !== null;
  const fileRef = useRef<HTMLInputElement>(null);
  const current = value ?? "";

  const label = useMemo(() => {
    if (current.startsWith("backup:")) {
      const match = backups.find((b) => `backup:${b.name}` === current);
      return match ? match.label || formatBackupName(match.name) : t`Backup`;
    }
    return "";
  }, [current, backups, t]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.endsWith(".tar.gz") && !file.name.endsWith(".tgz")) {
      toast.error(t`Select a .carbon.tar.gz backup`);
      return;
    }
    setUpload({ phase: "uploading", uploaded: 0, total: file.size });
    try {
      // Presigned upload straight to storage (the archive can exceed a
      // serverless request body), then the server unpacks it into `exports/<name>/`.
      const { path, token } = await postUploadIntent<{
        path: string;
        token: string;
      }>({ intent: "sign" });
      await uploadToSignedUrlWithProgress({
        bucket: TEMP_STAGING_BUCKET,
        path,
        token,
        file,
        onProgress: (uploaded, total) =>
          setUpload({ phase: "uploading", uploaded, total })
      });
      setUpload({ phase: "unpacking" });
      const { name } = await postUploadIntent<{ name: string }>({
        intent: "unpack",
        path
      });
      setValue(`backup:${name}`);
      toast.success(t`Backup uploaded`);
      revalidator.revalidate();
    } catch (err) {
      const reason = (err as Error).message || t`Network error`;
      toast.error(t`Failed to upload: ${reason}`);
    } finally {
      setUpload(null);
    }
  };

  return (
    <>
      <input type="hidden" name="source" value={current} />
      <input
        ref={fileRef}
        type="file"
        accept=".tar.gz,.tgz,application/gzip"
        className="hidden"
        onChange={onUpload}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={triggerClass}>
            <span
              className={
                current ? "truncate" : "truncate text-muted-foreground"
              }
            >
              {label || t`Choose a backup`}
            </span>
            <LuChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="p-0 w-[var(--radix-popover-trigger-width)]"
        >
          <Command>
            <CommandInput placeholder={t`Search…`} />
            <CommandList>
              <CommandEmpty>{t`No matches`}</CommandEmpty>
              {backups.length > 0 && (
                <CommandGroup heading={t`Your backups`}>
                  {backups.map((b) => (
                    <CommandItem
                      key={b.name}
                      value={`backup ${b.name}`}
                      onSelect={() => {
                        setValue(`backup:${b.name}`);
                        setOpen(false);
                      }}
                    >
                      <LuArchive className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                      <span className="flex flex-col">
                        <span>{b.label || formatBackupName(b.name)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBackupDate(b.exportedAt, false)}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="upload new backup"
                  disabled={uploading}
                  onSelect={() => {
                    setOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  <LuUpload className="mr-2 h-4 w-4 opacity-60" />
                  {uploading ? t`Uploading…` : t`Upload new backup…`}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {upload?.phase === "uploading" && (
        <UploadProgress
          className="mt-3"
          percent={upload.total ? (upload.uploaded / upload.total) * 100 : 0}
          uploaded={upload.uploaded}
          total={upload.total}
          label={t`Uploading backup`}
          description={t`Uploading the backup file`}
        />
      )}
      {upload?.phase === "unpacking" && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <LuLoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
          <span>{t`Preparing the backup for restore…`}</span>
        </div>
      )}
    </>
  );
}

async function postUploadIntent<T>(fields: Record<string, string>): Promise<T> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  const res = await fetch("/api/settings/backup-upload", {
    method: "POST",
    body: formData
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}
