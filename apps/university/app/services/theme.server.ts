import * as cookie from "cookie";

const cookieName = "theme";
const themes = [
  "zinc",
  "neutral",
  "red",
  "rose",
  "emerald",
  "blue",
  "yellow",
  "orange",
  "violet",
] as const;
type Theme = (typeof themes)[number];

export function getTheme(request: Request): Theme {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader ? cookie.parse(cookieHeader)[cookieName] : "blue";
  if (themes.includes(parsed as Theme)) return parsed as Theme;
  return "blue";
}

export function setTheme(theme: string) {
  return cookie.serialize(cookieName, theme, { path: "/", maxAge: 31536000 });
}
