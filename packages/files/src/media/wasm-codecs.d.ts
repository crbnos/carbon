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
