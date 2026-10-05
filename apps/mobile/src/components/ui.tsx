// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { forwardRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableScale } from "./PressableScale";

/**
 * The shop-floor primitives.
 *
 * Sized by `.claude/skills/carbon-design` → `shop-floor-mes.md`: operators work
 * standing, often gloved, on a shared tablet. So 48pt is the DEFAULT control
 * size, text starts at `text-base`, nothing is revealed on hover, and there is
 * exactly one colour-coded primary action per state.
 */

export function Screen({
  children,
  className,
  scroll = false,
  title,
  onBack,
  headerRight
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  /** Renders a sticky header. Omit it for a screen that titles itself. */
  title?: string;
  /** Adds a "‹ Back" target to the header. 48pt, left, where a thumb is. */
  onBack?: () => void;
  headerRight?: ReactNode;
}) {
  // `flex-1` ONLY when this is not scrolling. A `flex: 1` child of a
  // ScrollView's content container has no parent height to take a fraction of,
  // so on native it collapses to ZERO HEIGHT and every child becomes
  // invisible — a blank screen in the right background colour, with no error.
  // That is what `(setup)/connect` did on a fresh install, which is the first
  // screen the app ever shows. On web it happens to lay out, so a browser
  // never reveals it.
  const insets = useSafeAreaInsets();

  const body = (
    <View className={`${scroll ? "" : "flex-1"} px-4 ${className ?? ""}`}>
      {children}
    </View>
  );
  // Sticky rather than scrolling away: on a tablet clamped to a machine, the
  // only way back out of a screen must not depend on scroll position.
  const header =
    title || onBack || headerRight ? (
      <View className="flex-row items-center gap-2 border-b border-border bg-background px-4 pb-3">
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            className="min-h-[48px] flex-row items-center pr-3 active:opacity-60"
          >
            <Text className="text-2xl text-muted-foreground">{"\u2039"}</Text>
            <Text className="pl-1 text-base text-muted-foreground">Back</Text>
          </Pressable>
        ) : null}
        {title ? (
          <Text
            className="flex-1 text-xl font-semibold text-foreground"
            numberOfLines={1}
          >
            {title}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        {headerRight}
      </View>
    ) : null;

  return (
    /*
     * A plain `View` plus `useSafeAreaInsets()`, NOT `SafeAreaView`.
     *
     * Uniwind only gives `className` to React Native's own components.
     * `SafeAreaView` comes from react-native-safe-area-context, which is third
     * party, so it silently IGNORED `className="flex-1 bg-background"` — no
     * flex, no height, and every screen in the app rendered into a zero-height
     * box. Nothing threw, so there was no error to find: just a blank screen in
     * iOS's own default grey, which is a shade away from this theme's.
     *
     * `withUniwind()` from uniwind would also fix it, but the inset is a number
     * and a core `View` is the component this app is styled on everywhere else —
     * one less thing that can quietly stop honouring a class.
     */
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {header}
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow pb-8"
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

export function Heading({ children, className, ...props }: TextProps) {
  return (
    <Text
      className={`text-2xl font-semibold text-foreground ${className ?? ""}`}
      {...props}
    >
      {children}
    </Text>
  );
}

export function Body({ children, className, ...props }: TextProps) {
  return (
    <Text className={`text-base text-foreground ${className ?? ""}`} {...props}>
      {children}
    </Text>
  );
}

export function Muted({ children, className, ...props }: TextProps) {
  return (
    <Text
      className={`text-base text-muted-foreground ${className ?? ""}`}
      {...props}
    >
      {children}
    </Text>
  );
}

export function Card({ children, className, ...props }: ViewProps) {
  return (
    <View
      className={`rounded-lg border border-border bg-card p-4 ${className ?? ""}`}
      {...props}
    >
      {children}
    </View>
  );
}

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary border border-border",
  destructive: "bg-destructive",
  ghost: "bg-transparent"
};

const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: "text-primary-foreground",
  secondary: "text-secondary-foreground",
  destructive: "text-destructive-foreground",
  ghost: "text-foreground"
};

export function Button({
  children,
  variant = "primary",
  loading = false,
  disabled = false,
  className,
  ...props
}: PressableProps & {
  children: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  className?: string;
}) {
  const inactive = disabled || loading;
  return (
    <PressableScale
      // 48pt minimum: a gloved thumb, not a mouse.
      //
      // The press shrinks rather than fades. `active:opacity-80` was here
      // before and is gone deliberately: the two together read as the button
      // flinching, and opacity on a dark field is the weaker signal of the
      // pair under shop lighting.
      className={`min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg px-5 ${
        BUTTON_VARIANTS[variant]
      } ${inactive ? "opacity-50" : ""} ${className ?? ""}`}
      disabled={inactive}
      accessibilityRole="button"
      {...props}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Text className={`text-base font-semibold ${BUTTON_TEXT[variant]}`}>
          {children}
        </Text>
      )}
    </PressableScale>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label?: string }>(
  function Field({ label, className, ...props }, ref) {
    return (
      <View className="gap-2">
        {label ? <Muted className="text-sm">{label}</Muted> : null}
        <TextInput
          ref={ref}
          className={`min-h-[48px] rounded-lg border border-input bg-card px-4 text-base text-foreground ${
            className ?? ""
          }`}
          {...props}
        />
      </View>
    );
  }
);

/** A loading state is a skeleton, never an empty screen (design rules). */
export function Skeleton({ className }: { className?: string }) {
  return <View className={`rounded-lg bg-muted ${className ?? ""}`} />;
}

/** Shown only when a list is TRULY empty — never while it is still loading. */
export function EmptyState({
  title,
  description
}: {
  title: string;
  description?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2 py-16">
      <Body className="font-semibold">{title}</Body>
      {description ? (
        <Muted className="text-center">{description}</Muted>
      ) : null}
    </View>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-lg border border-destructive bg-destructive/10 p-3">
      <Text className="text-base text-destructive">{children}</Text>
    </View>
  );
}

export function WarningNote({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-lg border border-border bg-muted p-3">
      <Text className="text-sm text-muted-foreground">{children}</Text>
    </View>
  );
}
