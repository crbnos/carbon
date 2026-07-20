// This package ships raw source compiled by the consuming app's Vite build.
// Type the Vite-injected globals the source references without depending on
// vite (typecheck runs standalone via tsgo).
interface ImportMetaEnv {
  /** Build-time flag: "true" = server-artifacts-only viewer (the in-browser
   *  raw-CAD WASM tier and its occt-import-js chunk are dead-code-dropped).
   *  Unset/false (the default) = the WASM fallback tier is compiled in. */
  readonly VITE_CAD_VIEWER_USE_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
