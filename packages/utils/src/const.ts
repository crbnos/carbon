export const SUPPORT_EMAIL = "support@carbon.ms";

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
