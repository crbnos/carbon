// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Vite and Vitest replace import.meta.env.DEV at build time.
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
