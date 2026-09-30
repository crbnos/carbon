// This package ships raw source compiled by the consuming app's Vite build.
// Type the Vite asset queries the source references without depending on vite
// (typecheck runs standalone via tsgo).
declare module "*.wasm?inline" {
  const dataUri: string;
  export default dataUri;
}
