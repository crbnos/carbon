// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Fragment } from "react";
import { linkifyGlossary } from "~/utils/glossary";
import { Term } from "./Term";

/** Renders a plain string with known Carbon glossary terms auto-wrapped in an
 *  inline definition popover. */
export function GlossaryText({ children }: { children: string }) {
  const segments = linkifyGlossary(children);
  return (
    <>
      {segments.map((seg, i) =>
        typeof seg === "string" ? (
          <Fragment key={i}>{seg}</Fragment>
        ) : (
          <Term key={i} id={seg.slug}>
            {seg.text}
          </Term>
        )
      )}
    </>
  );
}
