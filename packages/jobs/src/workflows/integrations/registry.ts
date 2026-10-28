// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/// <reference path="./pieces.d.ts" />
import type { ActivepiecesPiece } from "@carbon/ee/integrations/pieces";
import { allowlistEntry } from "./allowlist";
import type { OAuth2AuthDeclaration, Piece, PieceAction } from "./types";

/** The ONLY module allowed to import a piece package. Pieces bundle Node-only vendor
 * SDKs, so nothing else may pull them into a graph that reaches the browser — and
 * `@carbon/workflows` compiles for the browser at ES2019. */

export class UnknownPieceError extends Error {
  constructor(name: string) {
    super(`"${name}" is not an available integration.`);
    this.name = "UnknownPieceError";
  }
}

export class UnknownPieceActionError extends Error {
  constructor(piece: string, action: string) {
    super(`"${action}" is not an available action on "${piece}".`);
    this.name = "UnknownPieceActionError";
  }
}

export class UnsupportedPieceAuthError extends Error {
  constructor(piece: string) {
    super(`"${piece}" does not offer an OAuth2 connection.`);
    this.name = "UnsupportedPieceAuthError";
  }
}

// Literal specifiers, not `import(entry.package)`: Vercel only copies into the
// serverless function the packages it can see imported, and a specifier held in a
// variable is invisible to it.
const PIECE_LOADERS: Record<
  ActivepiecesPiece,
  () => Promise<Record<string, unknown>>
> = {
  gmail: () => import("@activepieces/piece-gmail"),
  "google-calendar": () => import("@activepieces/piece-google-calendar"),
  slack: () => import("@activepieces/piece-slack")
};

const loaded = new Map<string, Piece>();

function looksLikeAPiece(value: unknown): value is Piece {
  return (
    typeof value === "object" &&
    value !== null &&
    "auth" in value &&
    typeof (value as Piece).actions === "function"
  );
}

export async function loadPiece(name: string): Promise<Piece> {
  const cached = loaded.get(name);
  if (cached !== undefined) return cached;

  const entry = allowlistEntry(name);
  if (entry === undefined) throw new UnknownPieceError(name);

  const module = await PIECE_LOADERS[name as ActivepiecesPiece]();
  // Find the piece by shape, not by export name — a future piece may name it differently.
  const piece = Object.values(module).find(looksLikeAPiece);
  if (piece === undefined) {
    throw new UnknownPieceError(name);
  }

  loaded.set(name, piece);
  return piece;
}

export async function getPieceActions(
  name: string
): Promise<Record<string, PieceAction>> {
  const entry = allowlistEntry(name);
  if (entry === undefined) throw new UnknownPieceError(name);

  const piece = await loadPiece(name);
  const all = piece.actions();
  const exposed: Record<string, PieceAction> = {};
  for (const action of entry.actions) {
    const found = all[action];
    if (found === undefined) throw new UnknownPieceActionError(name, action);
    exposed[action] = found;
  }
  return exposed;
}

export async function getPieceAction(
  name: string,
  action: string
): Promise<PieceAction> {
  // The allowlist decides what we expose, not the piece — `getPieceActions` is
  // that list. Own keys only: an action named `constructor` is not an action.
  const exposed = await getPieceActions(name);
  const found = Object.hasOwn(exposed, action) ? exposed[action] : undefined;
  if (found === undefined) throw new UnknownPieceActionError(name, action);
  return found;
}

/**
 * The piece's OAuth2 auth declaration — the vendor's URLs and scopes.
 *
 * **OAuth2 only, deliberately.** A piece authenticating with `SECRET_TEXT`,
 * `BASIC_AUTH` or `CUSTOM_AUTH` (an API key, a username and password) is refused
 * here rather than supported halfway. Those need a different design end to end: a
 * credential form in place of a consent screen, no callback route, and no refresh
 * cycle — none of which this path has. Adding one is its own piece of work, not a
 * branch in this function. See the header comment on `allowlist.ts`.
 */
export async function getPieceOAuth2Auth(
  name: string
): Promise<OAuth2AuthDeclaration> {
  const piece = await loadPiece(name);
  // A piece may offer several auth shapes (Google Calendar exposes OAUTH2 and
  // CUSTOM_AUTH). v1 supports OAuth2 only.
  const candidates = Array.isArray(piece.auth) ? piece.auth : [piece.auth];
  const oauth = candidates.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { type?: string }).type === "OAUTH2"
  );
  if (oauth === undefined) throw new UnsupportedPieceAuthError(name);
  return oauth as OAuth2AuthDeclaration;
}
