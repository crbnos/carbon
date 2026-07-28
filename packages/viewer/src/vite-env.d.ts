// This package ships raw source compiled by the consuming app's Vite build.
// Type the Vite-injected globals the source references without depending on
// vite (typecheck runs standalone via tsgo).
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
