// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Status } from "@carbon/react";
import { LuLock } from "react-icons/lu";
import type { qualityDocumentStatus } from "../../quality.models";

type QualityDocumentStatusProps = {
  status?: (typeof qualityDocumentStatus)[number] | null;
};

const QualityDocumentStatus = ({ status }: QualityDocumentStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Active":
      return (
        <Badge variant="green">
          <LuLock className="size-3 mr-1" />
          {status}
        </Badge>
      );
    case "Archived":
      return (
        <Badge variant="red">
          <LuLock className="size-3 mr-1" />
          {status}
        </Badge>
      );
    default:
      return null;
  }
};

export default QualityDocumentStatus;
