import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import type { EntryContext, RouterContextProvider } from "react-router";

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider // RouterContextProvider when v8_middleware is turned on
) {
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext // Vercel's handler still expecting AppLoadContext type
  );
}
