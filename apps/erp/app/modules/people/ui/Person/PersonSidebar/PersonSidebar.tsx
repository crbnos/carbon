// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DetailSidebar } from "~/components/Layout";
import type { PublicAttributes } from "~/modules/account";
import { usePersonSidebar } from "./usePersonSidebar";

type PersonSidebarProps = {
  attributeCategories: PublicAttributes[];
  timeCardEnabled?: boolean;
};

const PersonSidebar = ({
  attributeCategories,
  timeCardEnabled
}: PersonSidebarProps) => {
  const links = usePersonSidebar(attributeCategories, timeCardEnabled);

  return <DetailSidebar links={links} />;
};

export default PersonSidebar;
