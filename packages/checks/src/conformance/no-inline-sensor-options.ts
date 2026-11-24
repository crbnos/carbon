// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// dnd-kit's `useSensor(sensor, options)` memoizes on the options object. An
// inline literal is a new object on every render, so the sensor is new, and
// with it the listeners of every draggable under the context: a memoized card
// then re-renders on each render of its board. On the schedule board that was
// every card's full body each time the drop target changed, and a drag
// stuttered (frames over 100 ms with 82 cards).
const INLINE_OPTIONS = /^useSensor\(\s*\w+\s*,\s*\{/;

export const noInlineSensorOptions: ConformanceCheck = {
  id: "no-inline-sensor-options",
  description:
    "useSensor options must be a module constant, not an object literal created on every render",
  provenance: {
    deprecates: "useSensor(KeyboardSensor, { coordinateGetter })",
    replacedBy:
      "a module-level constant: useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)",
    since: "2026-10-06"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    const lines = contents.split("\n");
    lines.forEach((text, index) => {
      const at = text.search(/\buseSensor\(/);
      if (at < 0) return;
      // From the call onward, with the next lines: the options may start on
      // one of them.
      const call = `${text.slice(at)}\n${lines[index + 1] ?? ""}\n${lines[index + 2] ?? ""}`;
      if (!INLINE_OPTIONS.test(call)) return;
      violations.push({
        file,
        line: index + 1,
        snippet: text.trim(),
        message:
          "Hoist the options to a module constant: an inline object makes a new sensor, and new listeners for every draggable, on every render"
      });
    });
    return violations;
  }
};
