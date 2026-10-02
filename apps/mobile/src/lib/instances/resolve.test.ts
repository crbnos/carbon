// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  CARBON_CLOUD_URL,
  displayHost,
  probeOrder,
  resolveServerAddress
} from "./resolve";

describe("resolveServerAddress", () => {
  it("reads the server out of the QR code's link", () => {
    const qr = `carbon-mes://link?server=${encodeURIComponent(
      "https://mes.acme.com"
    )}`;
    expect(resolveServerAddress(qr)).toEqual({
      url: "https://mes.acme.com",
      scheme: "https",
      guessedScheme: false
    });
  });

  it("drops any path from a full URL — the client appends /api/v1 itself", () => {
    expect(
      resolveServerAddress("http://192.168.1.100:3001/x/operations")
    ).toEqual({
      url: "http://192.168.1.100:3001",
      scheme: "http",
      guessedScheme: false
    });
  });

  it("applies the BYOC mes. convention to a bare domain", () => {
    expect(resolveServerAddress("carbon.acme.com")?.url).toBe(
      "https://mes.carbon.acme.com"
    );
  });

  it("does not double the subdomain when the host already names mes", () => {
    expect(resolveServerAddress("mes.carbon.ms")?.url).toBe(
      "https://mes.carbon.ms"
    );
  });

  it("leaves a localhost host alone", () => {
    expect(resolveServerAddress("localhost:3001")?.url).toBe(
      "https://localhost:3001"
    );
  });

  it("refuses junk rather than guessing", () => {
    expect(resolveServerAddress("")).toBeNull();
    expect(resolveServerAddress("   ")).toBeNull();
    expect(resolveServerAddress("not a host")).toBeNull();
    expect(resolveServerAddress("carbon-mes://link")).toBeNull();
  });

  it("accepts Carbon Cloud's own address", () => {
    expect(resolveServerAddress(CARBON_CLOUD_URL)?.url).toBe(CARBON_CLOUD_URL);
  });
});

describe("probeOrder", () => {
  it("tries https then http only when the scheme was guessed", () => {
    const guessed = resolveServerAddress("acme.com");
    expect(guessed && probeOrder(guessed)).toEqual([
      "https://mes.acme.com",
      "http://mes.acme.com"
    ]);
  });

  it("never downgrades an address the user gave as https", () => {
    const explicit = resolveServerAddress("https://mes.acme.com");
    expect(explicit && probeOrder(explicit)).toEqual(["https://mes.acme.com"]);
  });
});

describe("displayHost", () => {
  it("shows the host a sign-in screen must display", () => {
    expect(displayHost("http://192.168.1.100:3001")).toBe("192.168.1.100:3001");
    expect(displayHost("https://mes.carbon.ms")).toBe("mes.carbon.ms");
  });
});
