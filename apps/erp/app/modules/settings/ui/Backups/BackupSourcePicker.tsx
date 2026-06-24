import { useCarbon } from "@carbon/auth";
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
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { LuArchive, LuChevronsUpDown, LuUpload } from "react-icons/lu";
import { useRevalidator } from "react-router";
import { formatBackupDate, formatBackupName } from "./format";

const triggerClass =
  "bg-transparent text-foreground flex h-10 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input px-3 py-2 text-sm shadow-xs outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

// One control combining your backups + upload new. Selecting one sets the
// hidden `source` field the restore form submits.
export function BackupSourcePicker({
  backups,
  companyId
}: {
  backups: { path: string; name: string; createdAt: string | null }[];
  companyId: string;
}) {
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();
  const [value, setValue] = useControlField<string>("source");
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = value ?? "";

  const label = useMemo(() => {
    if (current.startsWith("backup:")) {
      const match = backups.find((b) => `backup:${b.path}` === current);
      return match ? formatBackupName(match.name) : "Backup";
    }
    return "";
  }, [current, backups]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!carbon) {
      toast.error("Carbon client not found");
      return;
    }
    if (!file.name.endsWith(".gz")) {
      toast.error("Select a .carbon.json.gz backup");
      return;
    }
    setUploading(true);
    toast.info(`Uploading ${file.name}`);
    const { error: uploadError } = await carbon.storage
      .from(companyId)
      .upload(`exports/${file.name}`, file, { upsert: true });
    setUploading(false);
    if (uploadError) {
      toast.error(`Failed to upload: ${uploadError.message}`);
      return;
    }
    setValue(`backup:exports/${file.name}`);
    toast.success("Backup uploaded");
    revalidator.revalidate();
  };

  return (
    <>
      <input type="hidden" name="source" value={current} />
      <input
        ref={fileRef}
        type="file"
        accept=".gz,application/gzip"
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
              {label || "Choose a backup"}
            </span>
            <LuChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="p-0 w-[var(--radix-popover-trigger-width)]"
        >
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              {backups.length > 0 && (
                <CommandGroup heading="Your backups">
                  {backups.map((b) => (
                    <CommandItem
                      key={b.path}
                      value={`backup ${b.name}`}
                      onSelect={() => {
                        setValue(`backup:${b.path}`);
                        setOpen(false);
                      }}
                    >
                      <LuArchive className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                      <span className="flex flex-col">
                        <span>{formatBackupName(b.name)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBackupDate(b.createdAt, false)}
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
                  {uploading ? "Uploading…" : "Upload new backup…"}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
