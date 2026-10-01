// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export function Brackets() {
  return (
    <>
      <span className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-white pointer-events-none" />
      <span className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-white pointer-events-none" />
      <span className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-white pointer-events-none" />
      <span className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-white pointer-events-none" />
    </>
  );
}
