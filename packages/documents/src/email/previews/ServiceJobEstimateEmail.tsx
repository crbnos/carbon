// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ServiceJobEstimateEmail from "../ServiceJobEstimateEmail";

export default function ServiceJobEstimateEmailPreview() {
  return (
    <ServiceJobEstimateEmail
      companyName={"Acme Manufacturing"}
      serviceJobId={"SJ000012"}
      total={"$2,850.00"}
      itemName={"PUMP-100 Centrifugal Pump"}
      serial={"PUMP-100-S007"}
      recipientName={"John"}
      senderName={"Jane Smith"}
    />
  );
}
