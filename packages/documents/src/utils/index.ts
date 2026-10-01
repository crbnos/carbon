// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Client-safe: imported by browser code, so it must stay free of the react-pdf
// graph `./pdf` pulls in. Not a wildcard barrel — the per-document util files
// each export their own `getLineDescription`.
export { getPurchaseOrderDisplayId } from "./purchase-order";
export { getQuoteDisplayId } from "./quote";
export { withRevisionSuffix } from "./revision";
