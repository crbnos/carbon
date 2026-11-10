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
import { usePaneResize } from "./usePaneResize";
import { usePlan } from "./usePlan";
import { useRevalidator } from "./useRevalidator";
import { useRouteData } from "./useRouteData";
import { useRouteDialog } from "./useRouteDialog";
import type { Shortcut, ShortcutDefinition } from "./useShortcutKeys";
import { useShortcutKeyMap, useShortcutKeys } from "./useShortcutKeys";
import { useShortcutSequence } from "./useShortcutSequence";
import { useThemePreview } from "./useThemePreview";
import {
  setThemePreview,
  ThemeStyleProvider,
  useSavedThemeValue,
  useShellThemeStyle,
  useThemeContent,
  useThemeStyle,
  useThemeValue
} from "./useThemeStyle";
import useThrottle from "./useThrottle";
import { useDensityScale, useUiScale } from "./useUiScale";
import { useUrlParams } from "./useUrlParams";

export type { Shortcut, ShortcutDefinition };
export {
  getSystemMode,
  setThemePreview,
  ThemeStyleProvider,
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
  usePaneResize,
  usePlan,
  useRevalidator,
  useRouteData,
  useRouteDialog,
  useSavedThemeValue,
  useScanPending,
  useShellThemeStyle,
  useShortcutKeyMap,
  useShortcutKeys,
  useShortcutSequence,
  useThemeContent,
  useThemePreview,
  useThemeStyle,
  useThemeValue,
  useThrottle,
  useUiScale,
  useUrlParams
};
