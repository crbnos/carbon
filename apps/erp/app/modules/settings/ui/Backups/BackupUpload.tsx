import { useCarbon } from "@carbon/auth";
import { File as FileUpload, toast } from "@carbon/react";
import type { ChangeEvent } from "react";
import { useState } from "react";
import { useRevalidator } from "react-router";

/**
 * Uploads a `.carbon.json.gz` backup straight into the company bucket
 * under `exports/`, then revalidates so it appears in the import picker.
 * This is the "upload an environment" entry point — it lets an owner import
 * a backup exported from a different company (or the registry), not just
 * round-trip their own exports.
 */
export function BackupUpload({ companyId }: { companyId: string }) {
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();
  const [uploading, setUploading] = useState(false);

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
    const { error } = await carbon.storage
      .from(companyId)
      .upload(`exports/${file.name}`, file, { upsert: true });
    setUploading(false);

    if (error) {
      toast.error(`Failed to upload: ${error.message}`);
      return;
    }
    toast.success("Backup uploaded — pick it below to import");
    revalidator.revalidate();
  };

  return (
    <FileUpload
      accept=".gz,application/gzip"
      variant="secondary"
      isDisabled={uploading}
      onChange={onFileChange}
    >
      {uploading ? "Uploading…" : "Upload backup"}
    </FileUpload>
  );
}
