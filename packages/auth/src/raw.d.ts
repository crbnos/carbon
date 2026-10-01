// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// `?raw` text imports are resolved by the consuming app's Vite build (ERP / MES).
// This package is typechecked with tsgo, which doesn't know Vite's `?raw` suffix,
// so declare the module shape here. Used by `services/self-signup.server.ts`.
declare module "*?raw" {
  const content: string;
  export default content;
}
