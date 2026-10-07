// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AppBarOverride } from "./appBar";
import { createValueSlot } from "./slots";

/**
 * A temporary app bar a page can take over: list selection mode ("3 selected"
 * with Cancel), or a drilled-in screen with Back. The newest one shows;
 * cleared when its page unmounts.
 */
const appBarSlot = createValueSlot<AppBarOverride>();

export const useAppBarOverride = appBarSlot.useValue;

/** Take over the app bar while `override` is non-null. Memoize it. */
export const useSetAppBarOverride = appBarSlot.useProvide;
