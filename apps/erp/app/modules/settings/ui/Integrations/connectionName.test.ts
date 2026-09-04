import { describe, expect, it } from "vitest";
import { suggestConnectionName } from "./connectionName";

describe("suggestConnectionName", () => {
  it("uses the app's own name when nothing is connected", () => {
    expect(suggestConnectionName("Google Calendar", new Set())).toBe(
      "Google Calendar"
    );
  });

  // The reported bug: one account connected, and the suggestion collided with it.
  it("suggests a free name once the default is taken", () => {
    expect(
      suggestConnectionName("Google Calendar", new Set(["Google Calendar"]))
    ).toBe("Google Calendar 2");
  });

  it("keeps counting past the names already in use", () => {
    expect(
      suggestConnectionName(
        "Google Calendar",
        new Set(["Google Calendar", "Google Calendar 2", "Google Calendar 3"])
      )
    ).toBe("Google Calendar 4");
  });

  // A gap is fine to reuse — the point is a name nobody holds, not the highest number.
  it("fills a gap left by a renamed account", () => {
    expect(
      suggestConnectionName(
        "Google Calendar",
        new Set(["Google Calendar", "Google Calendar 3"])
      )
    ).toBe("Google Calendar 2");
  });

  it("never suggests a name that is already taken", () => {
    const taken = new Set(["Slack", "Slack 2", "Slack 4"]);
    expect(taken.has(suggestConnectionName("Slack", taken))).toBe(false);
  });
});
