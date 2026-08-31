/**
 * Stub for the `ws` package. `rhino3dm`'s bundle carries a Node-only branch
 * that does `require("ws")` for a WebSocket implementation, and it declares no
 * dependencies at all — so `ws` is not resolvable from it.
 *
 * esbuild (Vite 7) left that alone; Rolldown (Vite 8) resolves the import
 * statically while bundling the viewer's worker entry and fails the build.
 * Nothing in this app uses `ws`, and the branch never runs in a browser or
 * worker, so this only needs to load without throwing.
 */
"use strict";

class WebSocketStub {
  constructor() {
    throw new Error("ws is not available in the browser build");
  }
}

module.exports = WebSocketStub;
module.exports.default = WebSocketStub;
module.exports.WebSocket = WebSocketStub;
