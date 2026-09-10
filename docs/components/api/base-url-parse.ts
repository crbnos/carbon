/** Validate/normalize a user-entered base URL. Returns the cleaned URL or an error message. */
export function parseBaseUrl(raw: string): { url: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: "Enter a URL" };
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { error: "Not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "Use http:// or https://" };
  }
  const host = u.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (host !== "localhost" && !isIp && !host.includes(".")) {
    return { error: "Enter a valid host (e.g. rest.carbon.ms)" };
  }
  return { url: (u.origin + u.pathname).replace(/\/+$/, "") };
}
