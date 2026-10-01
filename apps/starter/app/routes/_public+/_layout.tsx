// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { Outlet } from "react-router";

export default function PublicRoute() {
  return (
    <div className="flex min-h-screen min-w-screen">
      <VStack
        spacing={8}
        className="items-center justify-start pt-[20vh] mx-auto max-w-lg z-[3]"
      >
        <Outlet />
      </VStack>
      {/* <Background /> */}
    </div>
  );
}
