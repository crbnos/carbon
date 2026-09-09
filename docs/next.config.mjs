import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Consume the shared status→color constants (@carbon/utils/status-colors) — a pure-TS
  // workspace module, so Next must transpile it.
  transpilePackages: ["@carbon/utils"],
  // `@carbon/glossary` uses Lingui `msg` macros so ERP/MES can translate entries
  // at render. Without an SWC transform, Turbopack bundles `@lingui/core/macro`
  // → `@lingui/conf` → Node `fs`, which breaks the build. The SWC plugin
  // compiles the macro down to plain `{ id, message }` literals so docs reads
  // `.message` directly without pulling the macro runtime.
  experimental: {
    swcPlugins: [["@lingui/swc-plugin", {}]],
  },
  // The monorepo pins React 18 (catalog) while this app runs React 19, so two
  // @types/react versions coexist and `next build` trips on the ReactNode /
  // ReactPortal type skew (a types-only artifact, not a runtime bug). Skip Next's
  // build-time typecheck; `pnpm typecheck` still runs tsc in CI.
  typescript: { ignoreBuildErrors: true },
  // Serving the dev server through a tunnel (ngrok) is cross-origin to
  // localhost:3002. Next 16 blocks cross-origin requests to its /_next dev
  // internals (RSC navigation, HMR) unless the tunnel origin is whitelisted,
  // which otherwise breaks client-side navigation while SSR still renders.
  allowedDevOrigins: [
    'protozoan-user-outline.ngrok-free.dev',
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
  ],
  // Serve the docs Overview at "/" without changing the URL — a server-side
  // rewrite, not a client/redirect bounce. `beforeFiles` runs ahead of the app router
  // so it takes precedence (app/page.tsx is removed).
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/docs" }],
    };
  },
  // Deployment moved under Self-hosting as the "AWS with SST" recipe; keep the old
  // URL alive by sending it to the Self-hosting overview.
  async redirects() {
    return [
      {
        source: "/docs/platform/deployment",
        destination: "/docs/platform/self-hosting",
        permanent: true,
      },
      // Architecture is developer content, so it moved under Building on Carbon;
      // single sign-on is admin content, so it moved into the Product reference
      // next to two-factor.
      {
        source: "/docs/platform/architecture",
        destination: "/docs/building/architecture",
        permanent: true,
      },
      {
        source: "/docs/platform/single-sign-on",
        destination: "/docs/reference/single-sign-on",
        permanent: true,
      },
      // The Data API moved from its own root to a section inside /api, so the whole
      // surface lives under one header entry, one sidebar and one host/API-key
      // configurator. Paths below the root are unchanged, so :path* maps 1:1 —
      // /api-reference/sales/customer -> /api/data/sales/customer.
      {
        source: "/api-reference/:path*",
        destination: "/api/data/:path*",
        permanent: true,
      },
      { source: "/api-reference", destination: "/api/data", permanent: true },
      // MCP folded into the Carbon API surface: MCP is a transport, not a top-level
      // surface. The old /mcp URLs redirect into /api. Operation slugs are unchanged
      // (they are the oRPC operation ids), so /mcp/tools/:tool maps 1:1.
      {
        source: "/mcp/tools/:tool",
        destination: "/api/operations/:tool",
        permanent: true,
      },
      { source: "/mcp/tools", destination: "/api", permanent: true },
      {
        source: "/mcp/authentication",
        destination: "/api/authentication",
        permanent: true,
      },
      { source: "/mcp", destination: "/api/mcp", permanent: true },
      // API keys moved from Reference into the Building section.
      {
        source: "/docs/reference/api-keys",
        destination: "/docs/building/api-keys",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
