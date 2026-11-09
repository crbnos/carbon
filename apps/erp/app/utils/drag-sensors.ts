// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MeasuringStrategy } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

// Shared so every drag starts the same way. A new options object makes a new
// sensor, and with it new listeners for every draggable on every render.

const DRAG_START_DISTANCE_PX = 8;

export const POINTER_SENSOR_OPTIONS = {
  activationConstraint: { distance: DRAG_START_DISTANCE_PX }
};

export const MOUSE_SENSOR_OPTIONS = {
  activationConstraint: { distance: DRAG_START_DISTANCE_PX }
};

/** A finger holds still first, so a swipe over the draggable still scrolls. */
export const TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 250, tolerance: 5 }
};

export const SORTABLE_KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates
};

export const ALWAYS_MEASURE_DROPPABLES = {
  droppable: { strategy: MeasuringStrategy.Always }
};
