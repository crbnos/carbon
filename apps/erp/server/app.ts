import { createRequestHandler, RouterContextProvider } from "react-router";
// @ts-expect-error
import * as build from "virtual:react-router/server-build";
import {
  isUnroutedWellKnownPath,
  wellKnownRoutePaths
} from "../app/utils/well-known";

const handler = createRequestHandler(build);
const isVercel = !!process.env.VERCEL_DEPLOYMENT_ID;

// Browsers probe `/.well-known/...` — answer the ones with no route directly, to
// avoid noisy "No route matches" errors in dev logs. Computed once from the
// build manifest so a real `.well-known` route is never swallowed: this check
// used to be an unconditional prefix match, which made every such route return
// an empty 204 instead of its body.
const routedWellKnownPaths = wellKnownRoutePaths(
  (build as { routes?: Record<string, { path?: string }> }).routes
);

const fn = (req: Request) => {
  try {
    const pathname = new URL(req.url).pathname;
    if (isUnroutedWellKnownPath(pathname, routedWellKnownPaths)) {
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
      fetch: fn
    };

export default wrapper;
