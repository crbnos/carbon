import { Submit, useControlField } from "@carbon/form";
import { ChoiceSelect } from "@carbon/react";
import { LuDatabaseBackup, LuFiles } from "react-icons/lu";

// What to bundle in a backup. Compact trigger; the trade-off shows on open.
export function IncludeStorageChoice() {
  const [value, setValue] = useControlField<"none" | "all">("includeStorage");
  const current = value ?? "none";
  return (
    <>
      <ChoiceSelect<"none" | "all">
        value={current}
        onChange={setValue}
        options={[
          {
            value: "none",
            title: "Data only",
            description:
              "Customers, items, orders and every record. Smaller and faster.",
            icon: <LuDatabaseBackup />
          },
          {
            value: "all",
            title: "Data + files",
            description:
              "Also bundles uploaded files — 3D models, documents and images.",
            icon: <LuFiles />
          }
        ]}
      />
      <input type="hidden" name="includeStorage" value={current} />
    </>
  );
}

// What to pull in on a restore. Data always loads; files are optional (and only
// present if the backup bundled them). A revert always restores files from the
// snapshot regardless, so the company never ends up missing its own files.
export function RestoreIncludeChoice() {
  const [value, setValue] = useControlField<"none" | "all">("includeStorage");
  const current = value ?? "all";
  return (
    <>
      <ChoiceSelect<"none" | "all">
        value={current}
        onChange={setValue}
        options={[
          {
            value: "all",
            title: "Data + files",
            description:
              "Records plus any uploaded files in the backup — 3D models, documents, images.",
            icon: <LuFiles />
          },
          {
            value: "none",
            title: "Data only",
            description:
              "Just the records. Skips bundled files — faster, and leaves current files in place.",
            icon: <LuDatabaseBackup />
          }
        ]}
      />
      <input type="hidden" name="includeStorage" value={current} />
    </>
  );
}

// Submit for the restore form — disabled until a source is chosen (the rest of
// the disabled/loading states come from Submit itself).
export function RestoreSubmit() {
  const [source] = useControlField<string>("source");
  return <Submit isDisabled={!source}>Restore</Submit>;
}
