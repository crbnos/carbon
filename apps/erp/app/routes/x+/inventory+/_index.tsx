// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirectBeforeLoaders } from "@carbon/utils";
import { moduleIndexLoader } from "~/utils/nav.server";

export const loader = moduleIndexLoader("inventory");

export const middleware = [redirectBeforeLoaders(loader)];
