// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/// <reference path="./vite-env.d.ts" />
import type { RootKey } from "./types";

// r1 signs manifests; r2 is the standby that can revoke r1.
// Roots live in commercial source only: never read them from the
// environment or the database, which would be an unlock by configuration.
export const PRODUCTION_ROOTS: RootKey[] = [
  {
    kid: "r1",
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: "8OdKjyMOWKyLgs2XaYlqrm5YEev9i3AxQonDf0DMWgY"
    }
  },
  {
    kid: "r2",
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: "ETdORQ4tsd0paDbXwYSU-_F59DWcYby0vwHPJXE3Z1s"
    }
  }
];

// The root of a local licence issuer. Development builds only; a production build drops it.
const DEV_ROOT: RootKey = {
  kid: "r-dev",
  key: {
    kty: "OKP",
    crv: "Ed25519",
    x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
  }
};

// import.meta.env is undefined outside Vite and Vitest (plain Node, tsx).
export function licenceRoots(): RootKey[] {
  return [...PRODUCTION_ROOTS, ...(import.meta.env?.DEV ? [DEV_ROOT] : [])];
}
