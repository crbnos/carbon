/**
 * Stub for the `ws` package. rhino3dm's Emscripten runtime does
 * `require("ws")` inside its `ENVIRONMENT_IS_NODE` socket branches — dead code
 * for us, since the viewer only ever loads `.3dm` geometry in the browser — but
 * the bundler still has to resolve the specifier. rhino3dm declares no
 * dependency on `ws`, so resolution only ever worked by accident when some
 * other package hoisted a copy to the workspace root; the `ws@8` override in
 * #1515 ended that and broke both app builds.
 *
 * Aliased rather than installed: adding `ws` as a real dependency would ship a
 * Node WebSocket implementation to satisfy a branch that never runs. Throws if
 * anything actually reaches for it, so a genuine need surfaces loudly instead
 * of failing strangely at runtime.
 */
"use strict";

function unavailable() {
  throw new Error(
    "`ws` is stubbed in this app: rhino3dm's Node socket path is not supported. If you need a real WebSocket client, add `ws` as an explicit dependency and drop this alias."
  );
}

class WebSocketStub {
  constructor() {
    unavailable();
  }
}

WebSocketStub.Server = class WebSocketServerStub {
  constructor() {
    unavailable();
  }
};

module.exports = WebSocketStub;
module.exports.default = WebSocketStub;
module.exports.WebSocket = WebSocketStub;
