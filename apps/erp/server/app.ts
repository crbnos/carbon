import { createRequestHandler, RouterContextProvider } from "react-router";
// @ts-expect-error
import * as build from "virtual:react-router/server-build";

const handler = createRequestHandler(build);
const isVercel = !!process.env.VERCEL_DEPLOYMENT_ID;

// @ts-expect-error
const fn = (req: Request) => handler(req, new RouterContextProvider());

const wrapper = isVercel
  ? fn
  : {
      fetch: fn,
    };

export default wrapper;
