import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
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
    "grown-outgoing-shad.ngrok-free.app",
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
};

export default withMDX(config);
