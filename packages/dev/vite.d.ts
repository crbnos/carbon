// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Plugin } from "vite";

export function applyDotenvToProcessEnv(mode: string, appDir: string): void;
export function clientOnlyAlias(specifier: string, file: string): Plugin;
export function stackActivity(): Plugin;

export function linguiWithoutIdQuery<T>(plugins: T[]): T[];
