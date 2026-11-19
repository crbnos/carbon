// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PortMap } from "./worktree.js";

/**
 * The apps `crbn up` offers. `kind` is how one runs: a React Router dev
 * server crbn supervises, another process it spawns, or a compose service.
 */
export const APPS = [
  {
    id: "erp",
    label: "ERP",
    hint: "main app",
    kind: "react-router",
    urlEnv: "ERP_URL",
    optIn: false
  },
  {
    id: "mes",
    label: "MES",
    hint: "shop floor",
    kind: "react-router",
    urlEnv: "MES_URL",
    optIn: false
  },
  {
    id: "assembler",
    label: "Assembler",
    hint: "CAD convert + motion planning",
    kind: "process",
    optIn: true
  },
  {
    id: "email",
    label: "Email previews",
    hint: "react-email server for every email template",
    kind: "process",
    optIn: true
  },
  {
    id: "studio",
    label: "Studio",
    hint: "Supabase dashboard for the local database",
    kind: "service",
    optIn: true
  }
] as const;
export type AppId = (typeof APPS)[number]["id"];
export type App = (typeof APPS)[number];

export const isAppId = (s: string): s is AppId => APPS.some((a) => a.id === s);

export const reactRouterApps = (ids: readonly AppId[]) =>
  APPS.filter(
    (a): a is Extract<App, { kind: "react-router" }> =>
      a.kind === "react-router" && ids.includes(a.id)
  );

/**
 * Every host crbn routes, as `<name>.<prefix>.<TLD>`, and the port behind it.
 * The apps' own names come first.
 */
export const ROUTES = {
  erp: "PORT_ERP",
  mes: "PORT_MES",
  api: "PORT_API",
  studio: "PORT_STUDIO",
  mail: "PORT_INBUCKET",
  email: "PORT_EMAIL",
  inngest: "PORT_INNGEST",
  assembler: "PORT_ASSEMBLER"
} as const satisfies Record<string, keyof PortMap>;
export type RouteName = keyof typeof ROUTES;

/** How a route shows in the `up` summary and a dev server's log prefix. */
export const ROUTE_STYLE = {
  erp: { label: "ERP", color: "cyan" },
  mes: { label: "MES", color: "magenta" },
  api: { label: "API", color: "green" },
  studio: { label: "Studio", color: "green" },
  mail: { label: "Mail", color: "yellow" },
  email: { label: "Email", color: "yellow" },
  inngest: { label: "Inngest", color: "blue" },
  assembler: { label: "Assembler", color: "yellow" }
} as const satisfies Record<
  RouteName,
  { label: string; color: "cyan" | "magenta" | "green" | "yellow" | "blue" }
>;

/** Hostname TLD portless serves under. */
export const TLD = "dev";

/** A route's portless alias (`erp.main`), served as `routeHost` (`erp.main.dev`). */
export const routeAlias = (name: RouteName, prefix: string) =>
  `${name}.${prefix}`;
export const routeHost = (name: RouteName, prefix: string) =>
  `${routeAlias(name, prefix)}.${TLD}`;

/**
 * The OAuth callback host, the same for every worktree (the last `crbn up`
 * wins), so the redirect URI is registered with Google and Azure once.
 */
export const OAUTH_HOST = `api.carbon.${TLD}`;

// localhost mode pins these, so its URLs and the OAuth redirect URI stay put.
export const LOCALHOST_PORTS = {
  PORT_API: 54321,
  PORT_ERP: 3000,
  PORT_MES: 3001
} as const satisfies Partial<PortMap>;

/** Minimum portless version that supports bare invocation + package.json config. */
export const PORTLESS_MIN_VERSION = "0.11.0";
