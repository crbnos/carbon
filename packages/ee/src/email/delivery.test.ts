// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { resolveEmailDelivery } from "./delivery";

const installed = (metadata: Record<string, unknown>) => ({
  active: true,
  metadata
});

describe("resolveEmailDelivery", () => {
  it("sends a company without the integration through server mail", () => {
    expect(resolveEmailDelivery(null, true)).toEqual({ provider: "server" });
    expect(resolveEmailDelivery({ active: false, metadata: {} }, true)).toEqual(
      { provider: "server" }
    );
  });

  it("cannot send without the integration or server mail", () => {
    expect(resolveEmailDelivery(undefined, false)).toBeNull();
  });

  it("keeps an installed Resend or SMTP provider either way", () => {
    for (const serverMail of [true, false]) {
      expect(
        resolveEmailDelivery(
          installed({ provider: "smtp", fromEmail: "a@b.co" }),
          serverMail
        )
      ).toEqual({ provider: "smtp", fromEmail: "a@b.co" });
    }
  });

  it("reads a legacy install without a provider as Resend", () => {
    expect(
      resolveEmailDelivery(installed({ fromEmail: "a@b.co" }), false)
    ).toEqual({ provider: "resend", fromEmail: "a@b.co" });
  });

  it("uses server mail with the company's From when set", () => {
    expect(
      resolveEmailDelivery(
        installed({ provider: "server", fromEmail: " sales@acme.co " }),
        true
      )
    ).toEqual({ provider: "server", fromEmail: "sales@acme.co" });
  });

  it("falls back to the server's From when the company sets none", () => {
    expect(
      resolveEmailDelivery(
        installed({ provider: "server", fromEmail: "" }),
        true
      )
    ).toEqual({ provider: "server", fromEmail: undefined });
  });

  it("cannot send through server mail the server does not have", () => {
    expect(
      resolveEmailDelivery(installed({ provider: "server" }), false)
    ).toBeNull();
  });
});
