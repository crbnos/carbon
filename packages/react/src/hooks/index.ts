// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCloseRoute } from "./useCloseRoute";
import useDebounce from "./useDebounce";
import useDisclosure from "./useDisclosure";
import { useEdition } from "./useEdition";
import useEscape from "./useEscape";
import useHydrated from "./useHydrated";
import { useIdle } from "./useIdle";
import useInitialDimensions from "./useInitialDimenions";
import { useInterval } from "./useInterval";
import useIsMobile from "./useIsMobile";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";
import { useKeyboardWedge } from "./useKeyboardWedge";
import useLocalStorage from "./useLocalStorage";
import {
  getSystemMode,
  useMode,
  useModePreference,
  useOptimisticMode
} from "./useMode";
import useMount from "./useMount";
import { useNProgress } from "./useNProgress";
import { useOptimisticLocation } from "./useOptimisticLocation";
import useOutsideClick from "./useOutsideClick";
import { usePlan } from "./usePlan";
import { useRouteData } from "./useRouteData";
import type { Shortcut, ShortcutDefinition } from "./useShortcutKeys";
import { useShortcutKeyMap, useShortcutKeys } from "./useShortcutKeys";
import { useShortcutSequence } from "./useShortcutSequence";
import useThrottle from "./useThrottle";
import { useUrlParams } from "./useUrlParams";

export {
  getSystemMode,
  useDebounce,
  useDisclosure,
  useEdition,
  useEscape,
  useHydrated,
  useInitialDimensions,
  useInterval,
  useIsMobile,
  useIsomorphicLayoutEffect,
  useKeyboardWedge,
  useLocalStorage,
  useMode,
  useCloseRoute,
  useIdle,
  useModePreference,
  useMount,
  useNProgress,
  useOptimisticLocation,
  useOptimisticMode,
  useOutsideClick,
  usePlan,
  useRouteData,
  useShortcutKeyMap,
  useShortcutKeys,
  useShortcutSequence,
  useThrottle,
  useUrlParams
};

export type { Shortcut, ShortcutDefinition };
