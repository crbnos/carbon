import { DOMAIN } from "@carbon/auth";
import type { Mode } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "mode";

export function getMode(request: Request): Mode | null {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader
    ? cookie.parse(cookieHeader)[cookieName]
    : "light";
  if (parsed === "light" || parsed === "dark") return parsed;
  return null;
}

export function setMode(mode: Mode | "system") {
  if (mode === "system") {
    return cookie.serialize(cookieName, "", { path: "/", maxAge: -1 });
  } else {
    return cookie.serialize(cookieName, mode, {
      path: "/",
      maxAge: 31536000,
      domain: DOMAIN,
    });
  }
}
