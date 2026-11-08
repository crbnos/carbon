// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const STACK_STATE_ENV: "CRBN_STACK_STATE";
export function activityFile(dir: string): string;
export function asleepFile(dir: string): string;
export const WAKE_TIMEOUT_MS: number;
export function isAsleepIn(dir: string): boolean;
