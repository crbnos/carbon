// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OeeProviderUnavailableError } from "../oee/types";
import { SenseApiError, SenseProvider } from "./provider";

const device = { externalDeviceId: "st-1", externalSiteId: "site-1" };
const window = {
  since: "2026-10-12T00:00:00.000Z",
  until: "2026-10-13T00:00:00.000Z"
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

const event = (n: number, status = "Active") => ({
  id: `ev-${n}`,
  device_id: "st-1",
  status,
  created_at: `2026-10-12T10:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`
});

const provider = () =>
  new SenseProvider({ apiKey: "test-key", environment: "staging" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SenseProvider", () => {
  it("maps every Sense status through the allowlist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            event(1, "Active"),
            event(2, "Idle"),
            event(3, "Alert"),
            event(4, "Offline")
          ]
        })
      )
    );
    const changes = await provider().listStateChanges(device, window);
    expect(changes.map((c) => c.state)).toEqual([
      "Running",
      "Idle",
      "Down",
      "Offline"
    ]);
    expect(changes[0]).toEqual({
      externalEventId: "ev-1",
      state: "Running",
      changedAt: event(1).created_at
    });
  });

  it("refuses a status outside the allowlist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ events: [event(1, "Calibrating")] }))
    );
    await expect(provider().listStateChanges(device, window)).rejects.toThrow(
      SenseApiError
    );
  });

  it("reports the provider unavailable when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(provider().listDevices()).rejects.toThrow(
      OeeProviderUnavailableError
    );
  });

  it("reports the provider unavailable on a 5xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Service Unavailable", { status: 503 }))
    );
    await expect(provider().listDevices()).rejects.toThrow(
      OeeProviderUnavailableError
    );
  });

  it("pages by time, never by offset, and drops repeated events", async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => event(i));
    const lastOfFirst = firstPage[499]!;
    const secondPage = [lastOfFirst, event(500), event(501), event(502)];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ events: firstPage }))
      .mockResolvedValueOnce(json({ events: secondPage }));
    vi.stubGlobal("fetch", fetchMock);

    const changes = await provider().listStateChanges(device, window);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(changes).toHaveLength(503);
    const second = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(second.searchParams.get("start_datetime")).toBe(
      lastOfFirst.created_at
    );
    expect(second.searchParams.has("offset")).toBe(false);
    expect(second.searchParams.get("order")).toBe("asc");
  });

  it("joins each station to its site's name and timezone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = String(input);
        if (url.endsWith("/v1/public/companies/stations")) {
          return json({
            stations: [
              {
                id: "st-1",
                machine_name: "Station 0002",
                machine_manufacturer: "Mazak",
                machine_type: "Mill - 4 Axis",
                machine_model: "Nexus 4000",
                site_id: "site-1",
                last_calibration_attempt_status: "CALIBRATED"
              },
              {
                id: "st-2",
                machine_name: "Station 0010",
                machine_manufacturer: "Matsuura",
                machine_type: "Mill - 5 Axis",
                machine_model: null,
                site_id: "site-2",
                last_calibration_attempt_status: "NOT_CALIBRATED"
              }
            ]
          });
        }
        return json({
          sites: [
            { id: "site-1", name: "Reston - 2", timezone: "UTC" },
            { id: "site-2", name: "Cleveland", timezone: "America/New_York" }
          ]
        });
      })
    );

    const devices = await provider().listDevices();

    expect(devices).toEqual([
      {
        externalDeviceId: "st-1",
        name: "Station 0002",
        externalSiteId: "site-1",
        siteName: "Reston - 2",
        siteTimezone: "UTC",
        manufacturer: "Mazak",
        model: "Nexus 4000",
        machineType: "Mill - 4 Axis",
        calibrated: true
      },
      {
        externalDeviceId: "st-2",
        name: "Station 0010",
        externalSiteId: "site-2",
        siteName: "Cleveland",
        siteTimezone: "America/New_York",
        manufacturer: "Matsuura",
        model: null,
        machineType: "Mill - 5 Axis",
        calibrated: false
      }
    ]);
  });
});
