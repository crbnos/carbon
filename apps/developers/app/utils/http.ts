import { path } from "./path";

export function getCurrentPath(request: Request) {
  return new URL(request.url).pathname;
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
  return safeRedirect(url.searchParams.get("redirectTo"), defaultRedirectTo);
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

/**
 * This should be used any time the redirect path is user-provided
 * (Like the query string on our login/signup pages). This avoids
 * open-redirect vulnerabilities.
 * @param {string} to The redirect destination
 * @param {string} defaultRedirect The redirect to use if the to is unsafe.
 */
export function safeRedirect(
  to: FormDataEntryValue | string | null | undefined,
  defaultRedirect = path.to.authenticatedRoot
) {
  if (
    !to ||
    typeof to !== "string" ||
    !to.startsWith("/") ||
    to.startsWith("//")
  ) {
    return defaultRedirect;
  }

  return to;
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
