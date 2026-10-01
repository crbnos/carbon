// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { PackingSlipData } from "./types";

export function HeaderBlock({ data }: { data: PackingSlipData }) {
  return (
    <Header
      company={data.company}
      title="Packing Slip"
      documentId={data.shipment?.shipmentId}
      date={data.shipment?.postingDate}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
