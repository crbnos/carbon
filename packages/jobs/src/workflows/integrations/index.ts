// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** Server-only. Piece packages bundle Node vendor SDKs — never import this
 * subpath from browser code. */
export type { AllowlistEntry } from "./allowlist";
export {
  allowlistEntry,
  assertPinnedVersions,
  PIECE_ALLOWLIST
} from "./allowlist";
export { buildPieceActionDeclarations } from "./catalog";
export { buildPieceContext } from "./context";
export type { PieceOAuthApp } from "./oauth";
export {
  accountLabelFromBody,
  buildConsentUrl,
  buildRefreshConfig,
  connectionMetadataFrom,
  requiredScopesFor,
  resolveOAuthApp
} from "./oauth";
export {
  CONNECTION_INPUT,
  CONNECTION_PROVIDER,
  PROPERTY_PROVIDER
} from "./options";
export type { MappedProperty } from "./properties";
export {
  toPropsValue,
  toValueType,
  UnmappablePropertyError
} from "./properties";
export {
  getPieceAction,
  getPieceActions,
  getPieceOAuth2Auth,
  loadPiece,
  UnknownPieceActionError,
  UnknownPieceError,
  UnsupportedPieceAuthError
} from "./registry";
export type {
  OAuth2AuthDeclaration,
  Piece,
  PieceAction,
  PieceOption,
  PieceProperty
} from "./types";
