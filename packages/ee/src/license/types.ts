// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The JSON contract of the WebAssembly verifier (globalThis.crbnClp.verify).

export type VerifierState = {
  manifest_version: number;
  revoked_roots: string[] | null;
  max_clock: string;
  clock_suspect: boolean;
};

export type RootKey = {
  kid: string;
  key: { kty: "OKP"; crv: "Ed25519"; x: string };
};

export type VerifyContext = "install" | "resolve";

export type VerifyInput = {
  /** A licence string, crbn.v1.<key>.<sealed>. */
  license?: string;
  /** A sealed envelope (a renewal) and the key that opens it. */
  sealed?: string;
  key?: string;
  roots: RootKey[];
  state: VerifierState;
  /** RFC 3339. */
  now: string;
  context: VerifyContext;
};

export type LicenceStatus = "active" | "expired" | "terminated";

export type LicenceView = {
  license_id: string;
  kind: "instance" | "cloud";
  issued_to: string;
  plan_id?: string;
  overrides?: Record<string, boolean>;
  seats?: number;
  mode: "connected" | "airgapped";
  issuer?: string;
  nonce?: string;
  issued_at: string;
  expires_at?: string;
  terminates_at?: string;
};

export type VerifyOutput =
  | {
      ok: true;
      status: LicenceStatus;
      license: LicenceView;
      /** The signed licence JSON, sent as-is on check-in. */
      signed_license: unknown;
      check_in_url?: string;
      state: VerifierState;
    }
  | { ok: false; error: string; state: VerifierState };

export const EMPTY_STATE: VerifierState = {
  manifest_version: 0,
  revoked_roots: [],
  max_clock: "0001-01-01T00:00:00Z",
  clock_suspect: false
};
