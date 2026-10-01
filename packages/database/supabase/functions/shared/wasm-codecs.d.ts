// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// libheif-js ships no TypeScript types; jSquash's subpath .js imports carry
// their own. Only what the image pipeline uses is declared here.
declare module "libheif-js/wasm-bundle.js" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: unknown) => void
    ): void;
  }
  class HeifDecoder {
    decode(bytes: Uint8Array | ArrayBuffer): HeifImage[];
  }
  const libheif: { HeifDecoder: typeof HeifDecoder };
  export default libheif;
}
