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

/**
 * One field of an action's declared output.
 *
 * Presentation metadata upstream — the Activepieces docs scope `outputSchema` to
 * "a friendly, labelled presentation ... without changing the expression paths used
 * in automations", `run()` returns `Promise<unknown | void>`, and nothing validates
 * a response against it. So it is good enough to OFFER an author paths and labels
 * at build time, and never good enough to enforce a shape at run time.
 */
export interface PieceOutputField {
  key: string;
  label: string;
  /** Dotted path to read from, relative to the container. Absent means read `key`. */
  value?: string;
  /** A display hint (`datetime`, `number`, `boolean`, `url`, `email`, …), not a type. */
  format?: string;
  /** Present when this field is a nested object. */
  children?: readonly PieceOutputField[];
  /** Present when this field is an array; describes ONE element. */
  listItems?: readonly PieceOutputField[];
  labelKey?: string;
  /** The vendor declaring that keys here vary per account and cannot be listed. */
  dynamicKey?: boolean;
}

export interface PieceOutputSchema {
  fields: readonly PieceOutputField[];
  itemLabel?: string;
}

export interface PieceAction {
  name: string;
  displayName: string;
  description?: string;
  props: Record<string, PieceProperty>;
  run: (context: unknown) => Promise<unknown>;
  /** Optional upstream: ~8% of pieces declare it, and coverage is all-or-nothing
   * per piece. `buildPieceActionDeclarations` refuses an action without one. */
  outputSchema?: PieceOutputSchema;
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
