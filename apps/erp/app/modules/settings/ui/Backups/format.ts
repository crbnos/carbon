// Backup filenames are `{timestamp}_{label-slug}.carbon.json.gz`. Turn the slug
// back into a readable title (the timestamp is shown separately as the date).
const BACKUP_ACRONYMS = new Set([
  "oem",
  "amr",
  "scara",
  "cad",
  "bom",
  "erp",
  "mes",
  "ai",
  "qa"
]);

export function formatBackupName(name: string): string {
  const base = name.replace(/\.carbon\.json\.gz$/i, "");
  const underscore = base.indexOf("_");
  const slug = underscore >= 0 ? base.slice(underscore + 1) : "";
  if (!slug) return "Untitled backup";
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) =>
      BACKUP_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

export function formatBackupDate(
  iso: string | null | undefined,
  withTime = true
): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(
    undefined,
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }
  );
}
