import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    // Light-only, like the editorial Guide.
    themeSwitch: { enabled: false },
    // The site-wide MainHeader carries the brand + nav; keep the Fumadocs sidebar
    // wordmark empty so "Carbon" isn't duplicated below the header.
    nav: {},
    links: [],
  };
}
