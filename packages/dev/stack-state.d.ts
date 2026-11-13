// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const STACK_STATE_ENV: "CRBN_STACK_STATE";
export function activityFile(dir: string): string;
export function asleepFile(dir: string): string;
export function bootingFile(dir: string): string;
export function upFile(dir: string): string;
export const WAKE_TIMEOUT_MS: number;
export const BOOT_TIMEOUT_MS: number;
export function isCloudDev(): boolean;
export function isAsleepIn(dir: string): boolean;
export function isBootingIn(dir: string): boolean;
export function livePid(marker: string): number | null;
