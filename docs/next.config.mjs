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
  // Serve the first guide at "/" without changing the URL — a server-side rewrite,
  // not a client/redirect bounce. `beforeFiles` runs ahead of the app router so it
  // takes precedence (app/page.tsx is removed).
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/guides/order" }],
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
    ];
  },
};

export default withMDX(config);
