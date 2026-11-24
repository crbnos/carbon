// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { findTrackedEntityByCode } from "./traveler.server";
import { fakeClient } from "./work-unit-test-fixture";

it("resolves only an active, exact pack-out pair sharing the printed serial", async () => {
  const companyId = "company";
  const serial = " SN-123 ";
  const source = {
    id: "built",
    companyId,
    readableId: serial,
    status: "Consumed"
  };
  const output = {
    id: "packed",
    companyId,
    readableId: serial,
    status: "Available"
  };
  const pair = {
    companyId,
    serial,
    sourceId: source.id,
    outputId: output.id,
    releasedAt: null
  };
  const tables = { trackedEntity: [source, output], jobUnitPairing: [pair] };
  const scan = (rows: Parameters<typeof fakeClient>[0], code = serial) =>
    findTrackedEntityByCode(fakeClient(rows).client, { companyId, code });
  expect(await scan(tables)).toEqual({ kind: "found", entity: output });
  expect(await scan(tables, source.id)).toEqual({
    kind: "found",
    entity: source
  });
  expect(await scan(tables, serial.trim())).toEqual({ kind: "notFound" });
  expect(
    await scan({
      ...tables,
      jobUnitPairing: [{ ...pair, releasedAt: "yesterday" }]
    })
  ).toEqual({ kind: "ambiguous" });
  expect(
    await scan({
      ...tables,
      trackedEntity: [...tables.trackedEntity, { ...source, id: "another" }]
    })
  ).toEqual({ kind: "ambiguous" });
});
