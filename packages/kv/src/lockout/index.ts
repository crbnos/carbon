// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type {
  AccountLockoutOptions,
  LockDurationOptions,
  LockoutStatus
} from "./lockout";
export {
  AccountLockout,
  DEFAULT_BASE_LOCK_SECONDS,
  DEFAULT_LEVEL_TTL_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_LOCK_SECONDS,
  DEFAULT_WINDOW,
  evaluateLockFromPttl,
  lockDurationSeconds,
  normalizeLoginIdentifier
} from "./lockout";
