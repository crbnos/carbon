// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** Sample data for previewing the Tracking Label template. Cast `any`. */
export const SAMPLE_TRACKING_LABEL = {
  items: [
    {
      itemId: "SD08810002",
      revision: "0",
      quantity: 1,
      number: "04/06/2026",
      trackedEntityId: "dtClCvNm9blDY0H3FXmDC",
      trackingType: "Serial"
    }
  ],
  labelSize: {
    id: "preview",
    name: "Preview",
    width: 4,
    height: 2,
    rows: 1,
    columns: 1,
    rotated: false
  }
} as any;
