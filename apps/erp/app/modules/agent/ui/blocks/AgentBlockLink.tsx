// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { linkBlock } from "../../agent.blocks";

export function AgentBlockLink({ input }: { input: unknown }) {
  const parsed = linkBlock.safeParse(input);
  if (!parsed.success) return null;
  const { label, url } = parsed.data;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-primary underline underline-offset-2 hover:opacity-80"
    >
      {label}
    </a>
  );
}
