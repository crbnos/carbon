/**
 * Carbon Learn — client-safe barrel.
 *
 * NEVER re-export a `*.server.ts` module from here: this barrel is reachable
 * from `~/modules/resources`, which client components import, so anything
 * exported here ships to the browser. Question banks, checkers, and the engine
 * are imported directly by route loaders/actions instead.
 */

export * from "./curriculum";
export * from "./docs";
export * from "./gamify";
export * from "./types";
