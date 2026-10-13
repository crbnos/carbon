// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { routeErrorCopy } from "./routeErrorCopy";

// The shape `isRouteErrorResponse` accepts.
const response = (status: number, data: unknown) => ({
  status,
  statusText: "",
  internal: false,
  data
});

describe("routeErrorCopy", () => {
  it("shows the server's message and the code for a 4xx", () => {
    expect(
      routeErrorCopy(response(404, "The item could not be found."))
    ).toEqual({
      status: 404,
      title: "Not found",
      message: "The item could not be found.",
      canRetry: false
    });
    expect(
      routeErrorCopy(response(400, { message: "Quantity is required" }))
    ).toMatchObject({ status: 400, message: "Quantity is required" });
  });

  it("falls back to the status's own copy when the body says nothing", () => {
    const copy = routeErrorCopy(response(404, "Not found"));
    expect(copy.title).toBe("Not found");
    expect(copy.message).toMatch(/moved or deleted/);
    expect(routeErrorCopy(response(403, "")).title).toBe(
      "You do not have access to this"
    );
  });

  it("does not show React Router's own message", () => {
    const copy = routeErrorCopy({
      ...response(405, 'Error: You made a POST request to "/x/job"'),
      internal: true
    });
    expect(copy.status).toBe(405);
    expect(copy.message).not.toMatch(/POST/);
  });

  it("never shows the text of a 5xx or a thrown Error", () => {
    for (const error of [
      response(500, 'relation "item" does not exist'),
      new Error("secret")
    ]) {
      const copy = routeErrorCopy(error);
      expect(copy.message).toMatch(/on our side/);
      expect(copy.canRetry).toBe(true);
    }
    expect(routeErrorCopy(response(500, "x")).status).toBe(500);
    expect(routeErrorCopy(new Error("x")).status).toBeUndefined();
  });
});
