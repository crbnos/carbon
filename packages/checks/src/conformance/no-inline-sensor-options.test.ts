// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noInlineSensorOptions } from "./no-inline-sensor-options";

const scan = (contents: string) =>
  noInlineSensorOptions.scan(
    "apps/erp/app/modules/production/ui/Schedule/Kanban/Kanban.tsx",
    contents
  );

describe("noInlineSensorOptions", () => {
  it("flags an inline options object, on one line or several", () => {
    expect(
      scan(
        `const sensors = useSensors(\n  useSensor(PointerSensor, { activationConstraint: { distance: 8 } })\n);\n`
      )
    ).toHaveLength(1);
    const violations = scan(
      `const sensors = useSensors(\n  useSensor(MouseSensor),\n  useSensor(KeyboardSensor, {\n    coordinateGetter\n  })\n);\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
  });

  it("accepts a sensor with no options or a module constant", () => {
    expect(
      scan(
        `const sensors = useSensors(\n  useSensor(MouseSensor),\n  useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)\n);\n`
      )
    ).toEqual([]);
  });
});
