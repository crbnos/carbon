// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    // Light-only, like the editorial Guide.
    themeSwitch: { enabled: false },
    // The site-wide MainHeader carries the brand + nav; keep the Fumadocs sidebar
    // wordmark empty so "Carbon" isn't duplicated below the header.
    nav: {},
    links: [],
  };
}
