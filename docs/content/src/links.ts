export const DOCS_URL = "https://docs.carbon.ms";

/** Public URL for a docs path, e.g. `docs/reference/jobs` or `/docs/reference/jobs#fields`. */
export function docUrl(path: string): string {
  return `${DOCS_URL}/${path.replace(/^\/+/, "")}`;
}
