import { PIECE_ALLOWLIST } from "./allowlist";
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

  const entry = PIECE_ALLOWLIST[name];
  if (entry === undefined) throw new UnknownPieceError(name);

  const module: Record<string, unknown> = await import(entry.package);
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
  const entry = PIECE_ALLOWLIST[name];
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
  const entry = PIECE_ALLOWLIST[name];
  if (entry === undefined) throw new UnknownPieceError(name);
  // The allowlist decides what we expose, not the piece.
  if (!entry.actions.includes(action)) {
    throw new UnknownPieceActionError(name, action);
  }

  const piece = await loadPiece(name);
  const found = piece.actions()[action];
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
