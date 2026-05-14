import { createRequestHandler, RouterContextProvider } from "react-router";
// @ts-expect-error
import * as build from "virtual:react-router/server-build";

const handler = createRequestHandler(build);
const isVercel = !!process.env.VERCEL_DEPLOYMENT_ID;

// Browsers probe `/.well-known/...` — no app route; avoid noisy "No route
// matches" errors in dev logs.
const fn = (req: Request) => {
  try {
    const pathname = new URL(req.url).pathname;
    if (pathname.startsWith("/.well-known/")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
  } catch {
    // fall through to handler
  }
  // @ts-expect-error RouterContextProvider matches runtime loadContext; types drift vs AppLoadContext
  return handler(req, new RouterContextProvider());
};

const wrapper = isVercel
  ? fn
  : {
      fetch: fn,
    };

export default wrapper;
