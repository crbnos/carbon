// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Imported for its effect, as the first import of each app's `entry.server.tsx`:
// modules evaluate in import order, so logging is configured before any other
// module loads, and a line one of them writes at load time gets the app's sinks.
import { ensureLoggingConfigured } from "./config.server";

ensureLoggingConfigured();
