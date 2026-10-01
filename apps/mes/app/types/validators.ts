// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Validator } from "@carbon/form";

export type TypeOfValidator<U extends Validator<any>> =
  U extends Validator<infer T> ? T : unknown;
