// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The pure half of attaching a photo to a work-instruction step.
 *
 * Named `photoUpload` rather than `stepPhoto` on purpose: `StepPhoto.tsx` is
 * the component beside it, and two files differing only in case are the same
 * file on a case-insensitive macOS checkout and two different ones in CI.
 *
 * A step photo is evidence — the gasket seated, the weld before grinding — and
 * it is stored where the web stores it so the ERP, the customer portal's file
 * route and this app all read one object. That means two things have to be
 * exactly right, and both are decided here rather than inside a component:
 * the storage KEY, and turning the picker's base64 into bytes.
 */

/** Characters a storage key may not carry, matching `stripSpecialCharacters`. */
export function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-]+$/g, "");
  return cleaned.length ? cleaned : "photo.jpg";
}

/**
 * Where a step photo lives.
 *
 * `${companyId}/job/${jobOperationId}/${stepId}/${unique}/${name}` — the shape
 * `BatchRecordModal.tsx` writes and, as its own comment says, the contract the
 * customer-portal file route authorizes against. The leading companyId is also
 * what `@carbon/files`' company bucket requires of every key it will accept,
 * so building the key this way is what keeps the upload inside the tenant's
 * own prefix. Do not "tidy" the segments.
 */
export function stepPhotoPath(args: {
  companyId: string;
  jobOperationId: string;
  stepId: string;
  unique: string;
  fileName: string;
}) {
  return [
    args.companyId,
    "job",
    args.jobOperationId,
    args.stepId,
    args.unique,
    safeFileName(args.fileName)
  ].join("/");
}

/** The company's private bucket, named after the company (see @carbon/files). */
export function companyBucketName(companyId: string) {
  const bucket = companyId
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  if (!bucket) {
    // `.from("")` would silently probe a bucket that does not exist and the
    // upload would fail with something unrelated. Refuse loudly instead —
    // the same choice `getCompanyPrivateBucket` makes.
    throw new Error("companyId is required to resolve the storage bucket");
  }
  return bucket;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 to bytes.
 *
 * `expo-image-picker` can hand back base64 directly, which avoids a second
 * native round-trip through the filesystem — but supabase-js's storage client
 * needs bytes, and React Native has no `Buffer` and an `atob` that is absent
 * on some engines. This is the decode, written out rather than taken as a
 * dependency: it is twenty lines and a dependency here would be a native-free
 * package added to a tree that is deliberately minimal.
 *
 * Throws on input that is not base64. A silently truncated image would upload
 * a corrupt object and record a step as photographed.
 */
export function base64ToBytes(base64: string): Uint8Array {
  // A data URI prefix is what you get if the caller forgets to strip it.
  const data = base64.includes(",")
    ? base64.slice(base64.indexOf(",") + 1)
    : base64;
  const clean = data.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw new Error("Not base64");
  }

  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding);

  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk =
      (BASE64_ALPHABET.indexOf(clean[i] as string) << 18) |
      (BASE64_ALPHABET.indexOf(clean[i + 1] as string) << 12) |
      (BASE64_ALPHABET.indexOf(
        clean[i + 2] === "=" ? "A" : (clean[i + 2] as string)
      ) <<
        6) |
      BASE64_ALPHABET.indexOf(
        clean[i + 3] === "=" ? "A" : (clean[i + 3] as string)
      );

    if (out < bytes.length) bytes[out++] = (chunk >> 16) & 0xff;
    if (out < bytes.length) bytes[out++] = (chunk >> 8) & 0xff;
    if (out < bytes.length) bytes[out++] = chunk & 0xff;
  }
  return bytes;
}
