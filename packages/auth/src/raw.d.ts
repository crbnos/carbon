// `?raw` text imports are resolved by the consuming app's Vite build (ERP / MES).
// This package is typechecked with tsgo, which doesn't know Vite's `?raw` suffix,
// so declare the module shape here. Used by `services/self-signup.server.ts`.
declare module "*?raw" {
  const content: string;
  export default content;
}
