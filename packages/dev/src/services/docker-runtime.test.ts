// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { dockerRuntime, dockerStartMode } from "./docker-runtime.js";

describe("dockerStartMode", () => {
  it("asks in a terminal", () => {
    expect(dockerStartMode({}, true)).toBe("ask");
  });

  it("starts without asking with no terminal or CARBON_DEV_YES=1", () => {
    expect(dockerStartMode({}, false)).toBe("auto");
    expect(dockerStartMode({ CARBON_DEV_YES: "1" }, true)).toBe("auto");
  });

  it("CARBON_DOCKER_AUTOSTART=0 wins over CARBON_DEV_YES=1", () => {
    expect(
      dockerStartMode(
        { CARBON_DOCKER_AUTOSTART: "0", CARBON_DEV_YES: "1" },
        false
      )
    ).toBe("off");
  });
});

describe("dockerRuntime", () => {
  const home = "/Users/dev";

  it("opens Docker Desktop on macOS, in the background", () => {
    expect(
      dockerRuntime(`unix://${home}/.docker/run/docker.sock`, "darwin", null)
    ).toEqual({
      name: "Docker Desktop",
      command: "open",
      args: ["-g", "-a", "Docker"]
    });
  });

  it("starts Docker Desktop's user service on Linux", () => {
    expect(
      dockerRuntime(
        "unix:///home/dev/.docker/desktop/docker.sock",
        "linux",
        null
      )
    ).toEqual({
      name: "Docker Desktop",
      command: "systemctl",
      args: ["--user", "start", "docker-desktop"]
    });
  });

  it("starts OrbStack", () => {
    expect(
      dockerRuntime(`unix://${home}/.orbstack/run/docker.sock`, "darwin", null)
    ).toEqual({ name: "OrbStack", command: "orbctl", args: ["start"] });
  });

  it("starts the Colima profile the socket belongs to", () => {
    expect(
      dockerRuntime(
        `unix://${home}/.colima/default/docker.sock`,
        "darwin",
        null
      )?.args
    ).toEqual(["start"]);
    expect(
      dockerRuntime(`unix://${home}/.colima/arm/docker.sock`, "darwin", null)
        ?.args
    ).toEqual(["start", "--profile", "arm"]);
    expect(
      dockerRuntime(
        "unix:///home/dev/.config/colima/default/docker.sock",
        "linux",
        null
      )?.command
    ).toBe("colima");
  });

  it("follows the default socket's link to the runtime that owns it", () => {
    expect(
      dockerRuntime(
        "unix:///var/run/docker.sock",
        "darwin",
        `${home}/.docker/run/docker.sock`
      )?.name
    ).toBe("Docker Desktop");
    expect(
      dockerRuntime(
        "unix:///var/run/docker.sock",
        "darwin",
        `${home}/.orbstack/run/docker.sock`
      )?.name
    ).toBe("OrbStack");
  });

  it("starts nothing it cannot name or start without sudo", () => {
    // A system dockerd: the default socket is no link.
    expect(dockerRuntime("unix:///var/run/docker.sock", "linux", null)).toBe(
      null
    );
    expect(dockerRuntime("tcp://10.0.0.5:2376", "darwin", null)).toBe(null);
    expect(dockerRuntime("ssh://dev@build-box", "darwin", null)).toBe(null);
    // No docker CLI, or no context.
    expect(dockerRuntime(null, "darwin", null)).toBe(null);
    // Docker Desktop's macOS socket path on another platform.
    expect(
      dockerRuntime(`unix://${home}/.docker/run/docker.sock`, "linux", null)
    ).toBe(null);
  });
});
