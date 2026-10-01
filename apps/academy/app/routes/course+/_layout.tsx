// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Outlet } from "react-router";
import { LearnShell } from "~/components/LearnShell";
import { OnThisPage } from "~/components/OnThisPage";

export default function CourseLayout() {
  return (
    <LearnShell rail={<OnThisPage />}>
      <Outlet />
    </LearnShell>
  );
}
