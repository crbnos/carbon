// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import {
  describeHealthcheckFailure,
  describeMountErrorBody,
  toMountApiError
} from "./errors";
import { MountApiError } from "./types";

function answered(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  const response = {
    status,
    statusText: "",
    data,
    headers: {},
    config
  } as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    config,
    {},
    response
  );
}

describe("toMountApiError", () => {
  it("replaces axios's generic message with what Mount said", () => {
    const error = toMountApiError(
      answered(400, {
        title: "One or more validation errors occurred.",
        errors: { Title: ["The Title field is required."] }
      })
    );

    expect(error).toBeInstanceOf(MountApiError);
    expect((error as MountApiError).status).toBe(400);
    expect((error as MountApiError).message).toBe(
      "Mount answered 400: One or more validation errors occurred. Title: The Title field is required."
    );
  });

  it("keeps the status so a deleted record can still be told apart", () => {
    const error = toMountApiError(answered(404, ""));
    expect((error as MountApiError).status).toBe(404);
    expect((error as MountApiError).message).toBe("Mount answered 404");
  });

  it("says Mount could not be reached when there was no answer", () => {
    const error = toMountApiError(
      new AxiosError("timeout of 30000ms exceeded", "ECONNABORTED")
    );
    expect((error as MountApiError).status).toBeNull();
    expect((error as MountApiError).message).toBe(
      "Could not reach Mount (ECONNABORTED)"
    );
  });

  it("passes anything else through untouched", () => {
    const original = new Error("not from axios");
    expect(toMountApiError(original)).toBe(original);
  });
});

describe("describeMountErrorBody", () => {
  it("reads an OAuth error from the token endpoint", () => {
    expect(
      describeMountErrorBody({
        error: "invalid_client",
        error_description: "Client authentication failed"
      })
    ).toBe("Client authentication failed");
  });

  it("drops an HTML page from a proxy", () => {
    expect(
      describeMountErrorBody("<!DOCTYPE html><html>502 Bad Gateway</html>")
    ).toBeNull();
  });

  it("caps a long body so one record cannot flood the page", () => {
    const text = describeMountErrorBody({ message: "x".repeat(1000) });
    expect(text).toHaveLength(301);
    expect(text?.endsWith("…")).toBe(true);
  });
});

describe("describeHealthcheckFailure", () => {
  it("points a refused token at the credentials", () => {
    const error = new MountApiError("Mount answered 401: invalid_client", 401);

    expect(describeHealthcheckFailure("token", error)).toBe(
      "Mount answered 401: invalid_client. Check the client ID, client secret and tenant, and that the secret has not expired in Mount."
    );
  });

  it("points a bodiless 403 at the client's member", () => {
    const error = new MountApiError("Mount answered 403", 403);

    expect(describeHealthcheckFailure("read", error)).toContain(
      "Mount answered 403. Mount accepted the client but refused the request: set a Member ID"
    );
  });

  it("points an unreachable host at the API URL", () => {
    const error = new MountApiError("Could not reach Mount (ENOTFOUND)", null);

    expect(describeHealthcheckFailure("token", error)).toBe(
      "Could not reach Mount (ENOTFOUND). Check the API URL."
    );
  });

  it("passes a settings problem through as it is", () => {
    expect(
      describeHealthcheckFailure(
        "read",
        new Error(
          'Mount domain "qa" not found. Use its identifier or title, as listed in Mount.'
        )
      )
    ).toBe(
      'Mount domain "qa" not found. Use its identifier or title, as listed in Mount.'
    );
  });
});
