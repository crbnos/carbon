// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Trans } from "@lingui/react/macro";
import { LuTimerOff } from "react-icons/lu";
import {
  UpgradeOverlay,
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayPreview,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import type { UnattributedMachineTime } from "./MachineTimeTable.ee";
import MachineTimeTable from "./MachineTimeTable.ee";

const mockRow = {
  companyId: "mock",
  createdAt: "2026-05-05T06:00:00Z",
  createdBy: "mock-user-1",
  updatedAt: null,
  updatedBy: null
} as const;

const mockMachineTimes: UnattributedMachineTime[] = [
  {
    ...mockRow,
    id: "mock-1",
    workCenterId: "mock-wc-1",
    workCenter: {
      name: "Haas VF-2",
      locationId: "mock-location",
      location: { name: "Main Plant", timezone: "UTC" }
    },
    startTime: "2026-05-05T06:12:00Z",
    endTime: "2026-05-05T07:47:00Z",
    startDate: "2026-05-05",
    endDate: "2026-05-05"
  },
  {
    ...mockRow,
    id: "mock-2",
    workCenterId: "mock-wc-2",
    workCenter: {
      name: "Mazak QTN-200",
      locationId: "mock-location",
      location: { name: "Main Plant", timezone: "UTC" }
    },
    startTime: "2026-05-05T09:30:00Z",
    endTime: "2026-05-05T09:52:00Z",
    startDate: "2026-05-05",
    endDate: "2026-05-05"
  },
  {
    ...mockRow,
    id: "mock-3",
    workCenterId: "mock-wc-1",
    workCenter: {
      name: "Haas VF-2",
      locationId: "mock-location",
      location: { name: "Main Plant", timezone: "UTC" }
    },
    startTime: "2026-05-05T13:05:00Z",
    endTime: null,
    startDate: "2026-05-05",
    endDate: null
  }
];

export default function MachineTimeUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <MachineTimeTable
          data={mockMachineTimes}
          count={mockMachineTimes.length}
          workCenters={[]}
          locations={[]}
        />
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuTimerOff className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Unattributed Time</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Assign machine run time that no loaded operation claimed to the
              right job, or dismiss it.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlay>
  );
}
