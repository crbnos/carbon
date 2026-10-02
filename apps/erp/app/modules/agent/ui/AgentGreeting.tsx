// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useState } from "react";
import { pickGreeting } from "./greetings";

// A static greeting bubble shown before any conversation starts. Chosen once per mount.
export function AgentGreeting() {
  const [greeting] = useState(pickGreeting);
  return (
    <div className="p-3">
      <div className="text-sm text-foreground">{greeting}</div>
    </div>
  );
}
