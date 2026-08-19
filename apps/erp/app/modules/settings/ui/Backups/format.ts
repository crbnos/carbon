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

/** "45s" / "2m 07s" — how long a long-running settings job has been going.
 *  Shared by the backup progress dialog and the demo-data review row. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
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
