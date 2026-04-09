import { DOMAIN } from "@carbon/auth";
import * as cookie from "cookie";

const cookieName = "theme";
const themes = [
  "zinc",
  "neutral",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet"
] as const;
type Theme = (typeof themes)[number];

export function getTheme(request: Request): Theme {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader ? cookie.parse(cookieHeader)[cookieName] : "zinc";
  if (themes.includes(parsed as Theme)) return parsed as Theme;
  return "zinc";
}

export function setTheme(theme: string) {
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    maxAge: 31536000
  };

  if (DOMAIN && !DOMAIN.startsWith("localhost")) {
    cookieOptions.domain = DOMAIN;
  }
  return cookie.serialize(cookieName, theme, cookieOptions);
}
