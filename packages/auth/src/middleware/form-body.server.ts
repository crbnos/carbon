// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MiddlewareFunction } from "react-router";

const FORM_TYPES = "application/x-www-form-urlencoded, multipart/form-data";
const API_DESCRIPTION = "/api/v1/openapi.json";
const HINT = {
  error: "This endpoint takes form data, not the content type that was sent.",
  accepts: FORM_TYPES.split(", "),
  hint: `This is a browser form endpoint. Programs should use the Carbon API, described at ${API_DESCRIPTION}.`
};
const HINT_HEADERS = {
  "Accept-Post": FORM_TYPES,
  Link: `<${API_DESCRIPTION}>; rel="service-desc"`
};

const INSTALLED = Symbol.for("carbon.formBodyGuard");

/**
 * Makes a form action answer a body it cannot read with a 4xx that says what to
 * send, instead of a 500.
 *
 * `request.formData()` throws a TypeError for a body that is not form data. The
 * browser never sends one, so the callers that hit this are scripts and agents
 * posting JSON to a page's form action. They get a 415 with `Accept-Post`
 * naming the accepted types and a `Link` to the API description, which is
 * where such a caller belongs. A form body that is malformed is a 400.
 *
 * Patched on the prototype, once per process, because React Router hands each
 * action its own `Request`: nothing set on the one a middleware sees reaches
 * it. The decision uses the request's own facts (was the body already read,
 * what is its content type), never the error's text, and a body read twice
 * (a server bug) is rethrown untouched.
 */
export function installFormBodyGuard(): void {
  const proto = Request.prototype as Request & { [INSTALLED]?: boolean };
  if (proto[INSTALLED]) return;
  proto[INSTALLED] = true;

  const readForm = Request.prototype.formData;
  Request.prototype.formData = async function formData(this: Request) {
    const alreadyRead = this.bodyUsed;
    try {
      return await readForm.call(this);
    } catch (error) {
      if (alreadyRead || !(error instanceof TypeError)) throw error;
      const type = this.headers.get("content-type") ?? "";
      const isForm = FORM_TYPES.split(", ").some((form) =>
        type.toLowerCase().startsWith(form)
      );
      if (isForm) {
        throw Response.json(
          { error: "The form body could not be read." },
          { status: 400 }
        );
      }
      throw Response.json(HINT, { status: 415, headers: HINT_HEADERS });
    }
  };
}

/**
 * Root middleware, paired with {@link installFormBodyGuard}. A response thrown
 * from an action of a page request is rendered as the HTML error page and loses
 * its headers, which tells a script nothing. Every 415 leaves with the
 * `Accept-Post` and `Link` hints, and as JSON unless the caller asked for HTML.
 * List it after the security middleware, so its response gets those headers.
 */
export const formBodyMiddleware: MiddlewareFunction<Response> = async (
  { request },
  next
) => {
  const response = await next();
  if (response.status !== 415) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(HINT_HEADERS)) {
    headers.set(name, value);
  }
  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return new Response(response.body, { status: 415, headers });
  }
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(HINT), { status: 415, headers });
};
