export const SUPPORT_EMAIL = "support@carbon.ms";

/** Carbon-internal email domains — the single source of truth for the
 *  "is this a Carbon employee" gate (used both client- and server-side). */
export const INTERNAL_EMAIL_DOMAINS = ["@carbon.us.org", "@carbon.ms"];

/** True for Carbon-internal users; gates internal-only features. Normalizes the
 *  address so the client flag and the server gate never diverge on casing. */
export function isInternalEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? "").toLowerCase().trim();
  return INTERNAL_EMAIL_DOMAINS.some((domain) => normalized.endsWith(domain));
}

export const FILE_SIZE_LIMIT_MB = {
  CAD_MODEL_UPLOAD: 120,
  DOCUMENT_UPLOAD: 50
} as const;

export const PO_EMAIL_ATTACHMENT_LIMIT_MB = 25;
export const PO_EMAIL_ATTACHMENT_WARN_MB = 20;

export const getFileSizeLimit = (type: keyof typeof FILE_SIZE_LIMIT_MB) => {
  const valueMegaBytes = FILE_SIZE_LIMIT_MB[type];
  const valueBytes = valueMegaBytes * 1024 * 1024;

  return {
    get megabytes() {
      return valueMegaBytes;
    },
    format() {
      return `${valueMegaBytes} ${valueMegaBytes > 1 ? "MBs" : "MB"}`;
    },
    get bytes() {
      return valueBytes;
    }
  } as const;
};
