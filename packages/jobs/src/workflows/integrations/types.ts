/** Structural shapes for the bits of an Activepieces piece Carbon actually reads.
 *
 * Declared here rather than imported from `@activepieces/pieces-framework`: the piece
 * packages bundle their framework, so it is not an installable dependency of ours. */

export type PiecePropertyType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "CHECKBOX"
  | "DATE_TIME"
  | "ARRAY"
  | "STATIC_DROPDOWN"
  | "STATIC_MULTI_SELECT_DROPDOWN"
  | "DROPDOWN"
  | "MULTI_SELECT_DROPDOWN"
  | (string & {});

export interface PieceOption {
  label: string;
  value: unknown;
}

export interface PieceProperty {
  type: PiecePropertyType;
  displayName?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?:
    | { options: readonly PieceOption[] }
    | ((...args: never[]) => unknown);
  refreshers?: readonly string[];
}

export interface PieceAction {
  name: string;
  displayName: string;
  description?: string;
  props: Record<string, PieceProperty>;
  run: (context: unknown) => Promise<unknown>;
}

export interface OAuth2AuthDeclaration {
  type: "OAUTH2";
  authUrl: string;
  tokenUrl: string;
  scope: readonly string[];
  pkce?: boolean;
  required?: boolean;
}

export interface Piece {
  displayName?: string;
  auth?: unknown;
  actions: () => Record<string, PieceAction>;
}
