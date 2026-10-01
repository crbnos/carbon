// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { QueryClient } from "@tanstack/react-query";

declare global {
  interface Window {
    clientCache: QueryClient;
  }
}

export {};
