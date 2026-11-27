// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { CustomizationKind, CustomizationStatus } from "../types";

export const CUSTOMIZATION_KINDS: Record<CustomizationKind, MessageDescriptor> =
  {
    configuration: msg`Configuration`,
    customField: msg`Custom field`,
    documentTemplate: msg`Document template`,
    integration: msg`Integration`,
    automation: msg`Automation`,
    report: msg`Report`,
    code: msg`Code change`
  };

export const CUSTOMIZATION_STATUSES: Record<
  CustomizationStatus,
  MessageDescriptor
> = {
  proposed: msg`Proposed`,
  agreed: msg`Agreed`,
  inProgress: msg`In progress`,
  done: msg`Done`,
  dropped: msg`Dropped`
};
