// Node-only: pre-instantiate the jSquash wasm codecs. Their default loaders
// fetch the .wasm relative to import.meta.url, which Node's fetch refuses for
// file: URLs — so server-side consumers of the image pipeline (paperless-parts,
// jobs, vitest) call this once first. Browser and Deno load the same wasm
// automatically; libheif needs nothing anywhere (its wasm is embedded in the JS
// bundle).
//
// The bytes come from the BUNDLER (`?inline` → a base64 data URI), never from
// disk. Resolving them at runtime — `createRequire(import.meta.url).resolve()` —
// works only while this file sits at its real path next to
// packages/files/node_modules; once a server build inlines @carbon/files the
// anchor moves into the output directory and both the package and the .wasm
// disappear, which is how every deployed paperless thumbnail failed with
// MODULE_NOT_FOUND. `?inline` is a Vite query, so this module is consumable only
// from a Vite pipeline (the ERP/MES server builds and vitest — the Deno
// functions never import it).
let initialized: Promise<void> | null = null;

const compile = (mod: { default: string }) =>
  WebAssembly.compile(
    Buffer.from(mod.default.slice(mod.default.indexOf(",") + 1), "base64")
  );

export function initNodeImageCodecs(): Promise<void> {
  initialized ??= (async () => {
    const [
      jpegDecode,
      jpegEncode,
      pngDecode,
      pngEncode,
      webpDecode,
      resize,
      jpegDecWasm,
      jpegEncWasm,
      pngWasm,
      webpDecWasm,
      resizeWasm
    ] = await Promise.all([
      import("@jsquash/jpeg/decode.js"),
      import("@jsquash/jpeg/encode.js"),
      import("@jsquash/png/decode.js"),
      import("@jsquash/png/encode.js"),
      import("@jsquash/webp/decode.js"),
      import("@jsquash/resize"),
      import("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?inline"),
      import("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?inline"),
      import("@jsquash/png/codec/pkg/squoosh_png_bg.wasm?inline"),
      import("@jsquash/webp/codec/dec/webp_dec.wasm?inline"),
      import("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm?inline")
    ]);

    // png decode and encode share one wasm, but each module keeps its own
    // instance — compile twice rather than hand the same Module to both.
    await Promise.all([
      jpegDecode.init(await compile(jpegDecWasm)),
      jpegEncode.init(await compile(jpegEncWasm)),
      pngDecode.init(await compile(pngWasm)),
      pngEncode.init(await compile(pngWasm)),
      webpDecode.init(await compile(webpDecWasm)),
      resize.initResize(await compile(resizeWasm))
    ]);
  })();
  return initialized;
}
