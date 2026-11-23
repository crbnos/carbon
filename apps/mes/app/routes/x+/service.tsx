// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";

// The queue is `service._index`; a job (`service.$jobId`) opens in its place.
export default function ServiceLayout() {
  return <RecordOutlet />;
}
