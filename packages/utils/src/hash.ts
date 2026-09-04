function murmur(str: string, seed: number) {
  var m = 0x5bd1e995;
  var r = 24;
  var h = seed ^ str.length;
  var length = str.length;
  var currentIndex = 0;

  while (length >= 4) {
    var k = UInt32(str, currentIndex);

    k = Umul32(k, m);
    k ^= k >>> r;
    k = Umul32(k, m);

    h = Umul32(h, m);
    h ^= k;

    currentIndex += 4;
    length -= 4;
  }

  switch (length) {
    case 3:
      h ^= UInt16(str, currentIndex);
      h ^= str.charCodeAt(currentIndex + 2) << 16;
      h = Umul32(h, m);
      break;

    case 2:
      h ^= UInt16(str, currentIndex);
      h = Umul32(h, m);
      break;

    case 1:
      h ^= str.charCodeAt(currentIndex);
      h = Umul32(h, m);
      break;
  }

  h ^= h >>> 13;
  h = Umul32(h, m);
  h ^= h >>> 15;

  return h >>> 0;
}

function UInt32(str: string, pos: number) {
  return (
    str.charCodeAt(pos++) +
    (str.charCodeAt(pos++) << 8) +
    (str.charCodeAt(pos++) << 16) +
    (str.charCodeAt(pos) << 24)
  );
}

function UInt16(str: string, pos: number) {
  return str.charCodeAt(pos++) + (str.charCodeAt(pos++) << 8);
}

function Umul32(n: number, m: number) {
  n = n | 0;
  m = m | 0;
  var nlo = n & 0xffff;
  var nhi = n >>> 16;
  var res = (nlo * m + (((nhi * m) & 0xffff) << 16)) | 0;
  return res;
}

export function getBucket(str: string, buckets: number) {
  var h = murmur(str, str.length);
  var bucket = h % buckets;
  return bucket;
}

const FNV_PRIME = 16777619;
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a. Not a checksum and not a secret — a cheap, stable content key. */
export function fnv1a32(input: string, seed: number = FNV_OFFSET): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), FNV_PRIME);
  }
  return hash >>> 0;
}

// Two 32-bit passes, not one 64-bit: BigInt needs ES2020 and apps/erp targets
// ES2019. Not node:crypto either — this package runs in the browser.
export function fnv1a64(input: string): string {
  const high = fnv1a32(input, FNV_OFFSET);
  const low = fnv1a32(input, FNV_PRIME);
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
