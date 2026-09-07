/** Shared config constants, deliberately free of `"use client"`.
 *
 *  Server components (the MCP page) interpolate these into build-time code samples
 *  while client components read them at render, so they cannot live in the client
 *  module: importing across that boundary hands the server a client reference
 *  rather than the primitive string. */

/** REST base for Carbon Cloud, and the literal baked into every generated sample. */
export const DEFAULT_API_BASE = "https://rest.carbon.ms";

/** App host for Carbon Cloud, where Settings and the MCP server live. */
export const DEFAULT_APP_ORIGIN = "https://app.carbon.ms";

export const DEFAULT_MCP_ENDPOINT = `${DEFAULT_APP_ORIGIN}/api/mcp`;

/** Stand-in for the origin when we don't know which instance the reader is on.
 *  Mirrors the `<api-key>` convention: obviously a placeholder when copy-pasted. */
export const HOST_PLACEHOLDER = "<your-host>";

/** Query params the ERP adds to its docs links: the deployment's REST origin and,
 *  because the two are configured independently, its app origin. */
export const HOST_PARAM = "host";
export const APP_PARAM = "app";
