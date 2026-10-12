// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { DateTime, Hyperlink } from "~/components";
import { path } from "~/utils/path";
import { useLesseeClassificationLabel } from "./LeaseClassificationPreview";
import LeaseMoney from "./LeaseMoney";
import type {
  Lease,
  LeaseEvent,
  LeaseFixedAssets,
  LeaseJournal,
  LeaseLine
} from "./types";

type LeaseEventsProps = {
  lease: Lease;
  lines: LeaseLine[];
  events: LeaseEvent[];
  journals: LeaseJournal[];
  fixedAssets: LeaseFixedAssets;
};

/** The lease's history after activation: each Modify, Terminate and
 *  Purchase, what it did to each asset's liability and right-of-use asset,
 *  and the journal it posted. */
const LeaseEvents = ({
  lease,
  lines,
  events,
  journals,
  fixedAssets
}: LeaseEventsProps) => {
  const { t } = useLingui();
  const classificationLabel = useLesseeClassificationLabel();
  const currencyCode = lease.currencyCode;
  const journalById = new Map(
    journals.map((journal) => [journal.id, journal.journalEntryId])
  );
  const assetName = new Map(lines.map((line) => [line.id, line.description]));

  const eventLabel = (value: LeaseEvent["eventType"]) => {
    switch (value) {
      case "Termination":
        return t`Termination`;
      case "Purchase":
        return t`Purchase`;
      default:
        return t`Modification`;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Events</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Every change to an active lease, with the amounts before and after.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No changes yet. Once the lease is active, Modify is in the header
              and each asset's Terminate and Purchase are on the Assets card.
            </Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Event</Trans>
                </Th>
                <Th>
                  <Trans>Asset</Trans>
                </Th>
                <Th>
                  <Trans>Effective</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Liability</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Right-of-Use Asset</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Gain (Loss)</Trans>
                </Th>
                <Th>
                  <Trans>Classification</Trans>
                </Th>
                <Th>
                  <Trans>Journal</Trans>
                </Th>
                <Th>
                  <Trans>Fixed Asset</Trans>
                </Th>
                <Th>
                  <Trans>Notes</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {events.map((event) => {
                const asset = event.fixedAssetId
                  ? fixedAssets[event.fixedAssetId]
                  : undefined;
                return (
                  <Tr key={event.id}>
                    <Td>{eventLabel(event.eventType)}</Td>
                    <Td>{assetName.get(event.leaseLineId) ?? "—"}</Td>
                    <Td>
                      <DateTime value={event.effectiveDate} variant="date" />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <LeaseMoney
                        value={event.liabilityBefore}
                        currencyCode={currencyCode}
                      />
                      {" → "}
                      <LeaseMoney
                        value={event.liabilityAfter}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <LeaseMoney
                        value={event.rouAssetBefore}
                        currencyCode={currencyCode}
                      />
                      {" → "}
                      <LeaseMoney
                        value={event.rouAssetAfter}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="text-right">
                      <LeaseMoney
                        value={event.gainLoss}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {event.classificationBefore === event.classificationAfter
                        ? classificationLabel(event.classificationAfter)
                        : `${classificationLabel(event.classificationBefore)} → ${classificationLabel(event.classificationAfter)}`}
                    </Td>
                    <Td>
                      {event.journalId ? (
                        <Hyperlink
                          to={path.to.journalEntryDetails(event.journalId)}
                        >
                          {journalById.get(event.journalId) ?? t`Journal`}
                        </Hyperlink>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      {event.fixedAssetId ? (
                        <Hyperlink
                          to={path.to.fixedAssetDetails(event.fixedAssetId)}
                        >
                          {asset?.fixedAssetId ?? asset?.name ?? t`Asset`}
                        </Hyperlink>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <span className="line-clamp-2">{event.notes ?? ""}</span>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default LeaseEvents;
