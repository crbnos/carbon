/**
 * Namespace for Carbon work-event ids. A fixed random UUID, per RFC 4122 §4.3 —
 * it only has to be constant, not secret.
 */
const CARBON_WORK_EVENT_NAMESPACE = "6f9c1f1a-3d3e-4a1e-9a4b-2c8f5b7e0d21";

/**
 * SHA-1, in plain TypeScript.
 *
 * Not `node:crypto`: the emit sites live in service files that React components
 * import for their types and enums, so this module lands in the client graph
 * even though every caller is server-side. A Node built-in there breaks the
 * browser bundle, and `crypto.subtle` is async, which would make every capture
 * site await a hash. Forty lines and one RFC test vector is the cheaper trade.
 *
 * SHA-1 is broken for signatures. This is a namespacing hash, never a security
 * boundary — RFC 4122 v5 specifies exactly this.
 */
function sha1(message: Uint8Array): Uint8Array {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const bitLength = message.length * 8;
  // One byte for the 0x80 terminator plus eight for the length, rounded up to
  // a whole 64-byte block.
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const block = new Uint8Array(paddedLength);
  block.set(message);
  block[message.length] = 0x80;

  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = ((x << 1) | (x >>> 31)) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp =
        ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, h0, false);
  digestView.setUint32(4, h1, false);
  digestView.setUint32(8, h2, false);
  digestView.setUint32(12, h3, false);
  digestView.setUint32(16, h4, false);
  return digest;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** RFC 4122 v5 (SHA-1, name-based). `uuid` is not in the workspace. */
function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);

  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes);
  input.set(nameBytes, namespaceBytes.length);

  const bytes = sha1(input).slice(0, 16);
  // Version 5.
  bytes[6] = ((bytes[6]! & 0x0f) | 0x50) >>> 0;
  // RFC 4122 variant.
  bytes[8] = ((bytes[8]! & 0x3f) | 0x80) >>> 0;

  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

/**
 * A stable event id for one real business occurrence.
 *
 * The same occurrence emitted twice — a retried request, a replayed Inngest
 * step, a double-clicked Post button — produces the same uuid, so the duplicate
 * collapses instead of inflating a count.
 *
 * PostHog's own de-duplication on `uuid` is eventual and explicitly not
 * guaranteed (https://posthog.com/docs/data/ingestion-warnings), so this id is
 * what the downstream warehouse de-duplicates on. Treat it as the primary key
 * of the occurrence, not as a hint.
 *
 * `parts` must be drawn only from values that are already fixed at the moment
 * the work happened. Never include a clock reading, a random id, or a value the
 * user can edit afterwards — any of those defeat the whole mechanism.
 */
export function workEventId(parts: {
  event: string;
  companyId: string;
  /** Primary key of the record the work happened to. */
  recordId: string;
  /**
   * Distinguishes repeatable work on one record — a line number, a sequence, a
   * target status. Omit when the event can only truly happen once per record.
   */
  discriminator?: string | number | null;
}): string {
  const discriminator =
    parts.discriminator === undefined || parts.discriminator === null
      ? ""
      : String(parts.discriminator);

  return uuidv5(
    [parts.companyId, parts.event, parts.recordId, discriminator].join(" "),
    CARBON_WORK_EVENT_NAMESPACE
  );
}

export const __testing = { uuidv5, sha1, toHex, CARBON_WORK_EVENT_NAMESPACE };
