// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { parseScan } from "./parseScan";

/** The instance this tablet is linked to, for every host comparison below. */
const LINKED = "http://192.168.1.100:3001";

describe("parseScan — Carbon routes", () => {
  it("reads a bare path, which is what a traveller QR usually encodes", () => {
    expect(parseScan("/x/operation/jo_abc123", LINKED)).toEqual({
      kind: "url",
      route: "operation",
      id: "jo_abc123"
    });
  });

  it("reads a full URL on the linked host", () => {
    expect(parseScan(`${LINKED}/x/start/jo_abc123`, LINKED)).toEqual({
      kind: "url",
      route: "start",
      id: "jo_abc123"
    });
  });

  it("ignores a trailing slash and a query string", () => {
    expect(parseScan(`${LINKED}/x/end/jo_1/`, LINKED)).toEqual({
      kind: "url",
      route: "end",
      id: "jo_1"
    });
    expect(parseScan(`${LINKED}/x/picking/pl_9?from=qr`, LINKED)).toEqual({
      kind: "url",
      route: "picking",
      id: "pl_9"
    });
  });

  it("trims the CR/LF a keyboard-mode scanner appends", () => {
    expect(parseScan("  /x/picking/pl_9\r\n", LINKED)).toEqual({
      kind: "url",
      route: "picking",
      id: "pl_9"
    });
  });

  it("ignores the scheme — a proxy terminating TLS is the same Carbon", () => {
    expect(
      parseScan("https://192.168.1.100:3001/x/operation/jo_1", LINKED)
    ).toEqual({ kind: "url", route: "operation", id: "jo_1" });
  });

  it("treats a default port and no port as the same host", () => {
    expect(
      parseScan(
        "https://mes.acme.com:443/x/operation/jo_1",
        "https://mes.acme.com"
      )
    ).toEqual({ kind: "url", route: "operation", id: "jo_1" });
  });
});

describe("parseScan — another instance's QR code", () => {
  /**
   * The case this check exists for. Web MES throws the host away and navigates
   * to the path on whatever Carbon the browser is on; a tablet holds several
   * linked Carbons, so doing that here would send an operator at another
   * company's work using an id that does not exist on their own instance.
   * Returning it as a plain code would be safe but unhelpful — "nothing
   * matches" reads as a typo. So it gets its own kind and the screen names the
   * host it came from.
   */
  it("refuses a Carbon route printed by a different host", () => {
    expect(parseScan("https://mes.other.com/x/start/jo_1", LINKED)).toEqual({
      kind: "other-instance",
      host: "mes.other.com",
      value: "https://mes.other.com/x/start/jo_1"
    });
  });

  it("counts a different port as a different instance — staging beside production", () => {
    expect(parseScan("http://192.168.1.100:3002/x/start/jo_1", LINKED)).toEqual(
      {
        kind: "other-instance",
        host: "192.168.1.100:3002",
        value: "http://192.168.1.100:3002/x/start/jo_1"
      }
    );
  });

  it("cannot confirm an absolute URL with no instance linked", () => {
    expect(parseScan("https://mes.acme.com/x/start/jo_1", null)).toEqual({
      kind: "other-instance",
      host: "mes.acme.com",
      value: "https://mes.acme.com/x/start/jo_1"
    });
  });

  it("still reads a bare path with no instance linked — it can only mean the linked one", () => {
    expect(parseScan("/x/start/jo_1", null)).toEqual({
      kind: "url",
      route: "start",
      id: "jo_1"
    });
  });
});

describe("parseScan — codes", () => {
  it("returns a serial or lot label as a code", () => {
    expect(parseScan("SN-00042", LINKED)).toEqual({
      kind: "code",
      value: "SN-00042"
    });
    expect(parseScan("  LOT_2026_04 \n", LINKED)).toEqual({
      kind: "code",
      value: "LOT_2026_04"
    });
  });

  it("returns a URL that is not a Carbon route as a code", () => {
    expect(parseScan("https://example.com/", LINKED)).toEqual({
      kind: "code",
      value: "https://example.com/"
    });
    expect(parseScan(`${LINKED}/x/jobs/j_1`, LINKED)).toEqual({
      kind: "code",
      value: `${LINKED}/x/jobs/j_1`
    });
  });

  it("refuses a deeper path — a web form action is not a scan target", () => {
    expect(parseScan(`${LINKED}/x/picking/pl_1/line/quantity`, LINKED)).toEqual(
      {
        kind: "code",
        value: `${LINKED}/x/picking/pl_1/line/quantity`
      }
    );
  });

  it("refuses a route with no id", () => {
    expect(parseScan("/x/picking", LINKED)).toEqual({
      kind: "code",
      value: "/x/picking"
    });
    expect(parseScan("/x/picking/", LINKED)).toEqual({
      kind: "code",
      value: "/x/picking/"
    });
  });

  it("returns an empty scan as an empty code rather than throwing", () => {
    expect(parseScan("   ", LINKED)).toEqual({ kind: "code", value: "" });
  });
});
