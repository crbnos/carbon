// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getNotificationTopicChannels,
  NotificationDestination,
  NotificationTopic,
  wantsPushDelivery
} from "./index";

describe("wantsPushDelivery", () => {
  it("stays quiet for an in-app-only event", () => {
    expect(wantsPushDelivery([NotificationDestination.InApp])).toBe(false);
  });

  it("pushes when the event emails", () => {
    expect(
      wantsPushDelivery([
        NotificationDestination.InApp,
        NotificationDestination.Email
      ])
    ).toBe(true);
  });

  it("pushes when the event posts to Slack", () => {
    expect(wantsPushDelivery([NotificationDestination.Slack])).toBe(true);
  });

  it("pushes when the caller asks for push", () => {
    expect(wantsPushDelivery([NotificationDestination.Push])).toBe(true);
  });
});

describe("getNotificationTopicChannels", () => {
  it("offers push for an ordinary topic but not for the changelog", () => {
    expect(getNotificationTopicChannels(NotificationTopic.Job)).toContain(
      "push"
    );
    expect(
      getNotificationTopicChannels(NotificationTopic.Changelog)
    ).not.toContain("push");
  });
});
