// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCloseRoute } from "./useCloseRoute";
import useDebounce from "./useDebounce";
import useDisclosure from "./useDisclosure";
import { useEdition } from "./useEdition";
import useEscape from "./useEscape";
import { useFeatureFlags } from "./useFeatureFlags";
import useHydrated from "./useHydrated";
import { useIdle } from "./useIdle";
import useInitialDimensions from "./useInitialDimenions";
import { useInterval } from "./useInterval";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";
import { useKeyboardWedge, useScanPending } from "./useKeyboardWedge";
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
import { useRevalidator } from "./useRevalidator";
import { useRouteData } from "./useRouteData";
import type { Shortcut, ShortcutDefinition } from "./useShortcutKeys";
import { useShortcutKeyMap, useShortcutKeys } from "./useShortcutKeys";
import { useShortcutSequence } from "./useShortcutSequence";
import { useThemePreview } from "./useThemePreview";
import useThrottle from "./useThrottle";
import { useDensityScale, useUiScale } from "./useUiScale";
import { useUrlParams } from "./useUrlParams";

export type { Shortcut, ShortcutDefinition };
export {
  getSystemMode,
  useCloseRoute,
  useDebounce,
  useDensityScale,
  useDisclosure,
  useEdition,
  useEscape,
  useFeatureFlags,
  useHydrated,
  useIdle,
  useInitialDimensions,
  useInterval,
  useIsomorphicLayoutEffect,
  useKeyboardWedge,
  useLocalStorage,
  useMode,
  useModePreference,
  useMount,
  useNProgress,
  useOptimisticLocation,
  useOptimisticMode,
  useOutsideClick,
  usePlan,
  useRevalidator,
  useRouteData,
  useScanPending,
  useShortcutKeyMap,
  useShortcutKeys,
  useShortcutSequence,
  useThemePreview,
  useThrottle,
  useUiScale,
  useUrlParams
};
