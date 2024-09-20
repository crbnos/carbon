import { installGlobals } from "@remix-run/node";
import { IncomingMessage } from "node:http";

export function installAndLockGlobals() {
  // @ts-ignore
  if (global.__installedAndLocked) {
    return;
  }

  installGlobals({ nativeFetch: true });

  const File = global.File;
  const Headers = global.Headers;
  const Request = global.Request;
  const Response = global.Response;
  const fetch = global.fetch;
  const FormData = global.FormData;

  /* @vercel/remix expects the non-native Headers API
     see: https://github.com/vercel/remix/blob/325c03d4c395b3c48aee88b1574c4688ee59251e/packages/vercel-remix/server.ts#L105
     This adds a minimal compatibility layer, though the result is different
     when multiple values for the same header are added.
     {
       "header": [
         "value1, value2"
       ]
     }
     vs
     {
       "header": [
         "value1",
         "value2"
       ]
     }
     This should be fine, but hasn't been extensively tested.
     Need to patch the prototype here since undici holds a reference.
   */
  if (!Object.hasOwn(Headers.prototype, "raw")) {
    Object.defineProperties(Headers.prototype, {
      raw: {
        value: function raw() {
          const entries: Iterable<[string, string]> = this.entries();
          return Object.fromEntries(
            Array.from(entries).map(([k, v]) => [k, [v]])
          );
        },
        configurable: true,
      },
    });
  }

  /* @vercel/remix doesn't set duplex when initializing a steaming body
     see: https://github.com/vercel/remix/blob/325c03d4c395b3c48aee88b1574c4688ee59251e/packages/vercel-remix/server.ts#L83-L94
   */
  class PatchedRequest extends Request {
    constructor(input: RequestInfo | URL, init: RequestInit = {}) {
      let initPatched = init;
      if (
        init.body &&
        init.body instanceof IncomingMessage &&
        init.duplex === undefined
      ) {
        initPatched = {
          ...init,
          duplex: "half",
        };
      }
      super(input, initPatched);
    }
  }

  // Ignore future changes to these properties
  Object.defineProperties(global, {
    File: {
      get() {
        return File;
      },
      set() {},
    },
    Headers: {
      get() {
        return Headers;
      },
      set() {},
    },
    Request: {
      get() {
        return PatchedRequest;
      },
      set() {},
    },
    Response: {
      get() {
        return Response;
      },
      set() {},
    },
    fetch: {
      get() {
        return fetch;
      },
      set() {},
    },
    FormData: {
      get() {
        return FormData;
      },
      set() {},
    },
  });

  // @ts-ignore
  global.__installedAndLocked = true;
}
