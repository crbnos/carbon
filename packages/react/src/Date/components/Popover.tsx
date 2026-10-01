// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRef } from "react";
import { useEscape, useOutsideClick } from "../../hooks";

export function Popover(props: any) {
  const ref = useRef();
  const { popoverRef = ref, onClose, children, ...rest } = props;

  useEscape(onClose);
  useOutsideClick({
    ref: popoverRef,
    handler: onClose
  });

  return (
    <div
      {...rest}
      className="absolute rounded-md z-[10] top-[100%] shadow-lg mt-1 p-6 outline-none bg-popover"
    >
      {children}
    </div>
  );
}
