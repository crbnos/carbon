// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { safePath } from "@carbon/utils";
import { path } from "./path";

const log = getLogger("auth");

export function getCurrentPath(request: Request) {
  const url = new URL(request.url);
  // `_routes` is React Router's single-fetch transport param. Loaders never
  // see it, but middleware does (MES runs auth there), and a page URL that
  // carries it limits which loaders later data requests run. Only when it is
  // present: `delete` re-encodes the whole query (`a:b` to `a%3Ab`, `?index`
  // to `?index=`), and every other URL should come back exactly as it was.
  if (url.searchParams.has("_routes")) url.searchParams.delete("_routes");
  return `${url.pathname}${url.search}`;
}

export function makeRedirectToFromHere(request: Request) {
  const currentPath = getCurrentPath(request);
  return new URLSearchParams([["redirectTo", currentPath]]);
}

export function getRedirectTo(
  request: Request,
  defaultRedirectTo = path.to.authenticatedRoot
) {
  const url = new URL(request.url);
  return safePath(url.searchParams.get("redirectTo"), defaultRedirectTo);
}

export function isGet(request: Request) {
  return request.method.toLowerCase() === "get";
}

export function isPost(request: Request) {
  return request.method.toLowerCase() === "post";
}

export function isDelete(request: Request) {
  return request.method.toLowerCase() === "delete";
}

export function notAuthorized(message: string) {
  return new Response(message, { status: 401 });
}

export function notFound(message: string) {
  return new Response(message, { status: 404 });
}

function notAllowedMethod(message: string) {
  return new Response(message, { status: 405 });
}

export function badRequest(message: string) {
  return new Response(message, { status: 400 });
}

export function getRequiredParam(
  params: Record<string, string | undefined>,
  key: string
) {
  const value = params[key];

  if (!value) {
    throw badRequest(`Missing required request param "${key}"`);
  }

  return value;
}

export function assertIsPost(request: Request, message = "Method not allowed") {
  if (!isPost(request)) {
    throw notAllowedMethod(message);
  }
}

export function assertIsDelete(
  request: Request,
  message = "Method not allowed"
) {
  if (!isDelete(request)) {
    throw notAllowedMethod(message);
  }
}

export function parseNumberFromUrlParam(
  params: URLSearchParams,
  key: string,
  defaultValue: number
): number {
  const value = params.get(key);
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

export function parseVercelId(id: string | null) {
  const parts = id?.split(":").filter(Boolean);
  if (!parts) {
    log.debug('"x-vercel-id" header not present. Running on localhost?');
    return { proxyRegion: "localhost", computeRegion: "localhost" };
  }
  const proxyRegion = parts[0];
  const computeRegion = parts[parts.length - 2];
  return { proxyRegion, computeRegion };
}
