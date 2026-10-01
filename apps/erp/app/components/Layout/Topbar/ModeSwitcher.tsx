// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { IconButton, useMode } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { BiLaptop, BiMoon, BiSun } from "react-icons/bi";
import { useFetcher } from "react-router";
import type { action } from "~/root";
import { startModeTransition } from "~/utils/dom";
import { path } from "~/utils/path";

const ModeSwitcher = () => {
  const { t } = useLingui();
  const mode = useMode();
  const nextMode = mode === "dark" ? "light" : "dark";
  const modeLabel = {
    light: <BiSun />,
    dark: <BiMoon />,
    system: <BiLaptop />
  };

  const fetcher = useFetcher<typeof action>();

  const onClick = () => {
    const formData = new FormData();
    formData.append("mode", nextMode);
    startModeTransition(nextMode, () => {
      fetcher.submit(formData, { method: "post", action: path.to.root });
    });
  };

  return (
    <IconButton
      icon={modeLabel[nextMode]}
      aria-label={t`Light Mode`}
      variant="ghost"
      onClick={onClick}
      className="hidden sm:block"
    />
  );
};

export default ModeSwitcher;
