// Node-only: pre-instantiate the jSquash wasm codecs from disk. Their default
// loaders fetch the .wasm relative to import.meta.url, which Node's fetch
// refuses for file: URLs — so server-side consumers of the image pipeline
// (paperless-parts, jobs, vitest) call this once first. Browser and Deno load
// the same wasm automatically; libheif needs nothing anywhere (its wasm is
// embedded in the JS bundle). Import via "@carbon/files/media/node" only from
// server code — this module touches node:fs.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

let initialized: Promise<void> | null = null;

export function initNodeImageCodecs(): Promise<void> {
  initialized ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasm = async (specifier: string) =>
      WebAssembly.compile(await readFile(require.resolve(specifier)));

    const [jpegDecode, jpegEncode, pngDecode, pngEncode, webpDecode, resize] =
      await Promise.all([
        import("@jsquash/jpeg/decode.js"),
        import("@jsquash/jpeg/encode.js"),
        import("@jsquash/png/decode.js"),
        import("@jsquash/png/encode.js"),
        import("@jsquash/webp/decode.js"),
        import("@jsquash/resize")
      ]);

    await Promise.all([
      jpegDecode.init(await wasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm")),
      jpegEncode.init(await wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm")),
      pngDecode.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm")),
      pngEncode.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm")),
      webpDecode.init(await wasm("@jsquash/webp/codec/dec/webp_dec.wasm")),
      resize.initResize(
        await wasm("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm")
      )
    ]);
  })();
  return initialized;
}
