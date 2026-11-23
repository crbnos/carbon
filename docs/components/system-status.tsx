// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useEffect, useState } from "react";

/** Footer status link, read from Checkmate through /api/status (same rule as carbon.ms). */
export function SystemStatus() {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((status: { up: boolean }) => setUp(status.up))
      .catch(() => setUp(false));
  }, []);

  const label = up === null ? "Checking status…" : up ? "Operational" : "Incident detected";
  const dot =
    up === null
      ? "bg-white/40"
      : up
        ? "bg-[#3FB950] shadow-[0_0_6px_rgba(63,185,80,0.7)]"
        : "bg-[#F85149] shadow-[0_0_6px_rgba(248,81,73,0.7)]";

  return (
    <a
      href="https://status.carbon.ms"
      target="_blank"
      rel="noreferrer noopener"
      className="mt-[3px] inline-flex items-center gap-[7px] text-ed-14 text-white/85 transition-colors hover:text-white"
    >
      {label}
      <span className={`inline-block h-[7px] w-[7px] rounded-full ${dot}`} />
    </a>
  );
}
