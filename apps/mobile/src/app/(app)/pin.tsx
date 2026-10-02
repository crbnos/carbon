// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Delete } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { usePinIn, usePinOut } from "~/features/console/commands";
import {
  type ConsoleOperatorOption,
  useConsoleOperators
} from "~/features/console/useConsoleOperators";
import { commandMessage } from "~/features/operations/commands";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The shared-terminal PIN screen: pick a name, enter a PIN.
 *
 * A keypad and not a text field. The operator is standing at a machine, often
 * gloved, and a 72pt key is hittable where a keyboard is not — and
 * `secureTextEntry` on a soft keyboard still shows each character as it is
 * typed on both platforms, which is worse than dots over somebody's shoulder.
 *
 * The PIN is never stored, never logged, and never put in a query key. It
 * lives in this component's state until it is submitted and is cleared on
 * every outcome, including a failure — a wrong PIN left in the field is one
 * stray tap from being submitted again and spending another attempt against
 * the lockout.
 */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
const MIN_PIN = 4;
const MAX_PIN = 8;

export default function PinIn() {
  const { t } = useLingui();
  const colors = useThemeColors();
  const { me, terminalToken, operator } = useAuth();
  const [selected, setSelected] = useState<ConsoleOperatorOption | null>(null);
  const [pin, setPin] = useState("");
  const operators = useConsoleOperators(Boolean(terminalToken));
  const pinIn = usePinIn();
  const pinOut = usePinOut();

  // Terminal mode is a company setting AND an entitlement. Saying which is
  // missing is not this screen's job, but saying that it is off, is.
  if (!me?.consoleAvailable) {
    return (
      <Screen className="gap-4 py-4" title={t`Operators`} onBack={router.back}>
        <WarningNote>
          {t`Shared-terminal mode is not available on this Carbon.`}
        </WarningNote>
      </Screen>
    );
  }

  if (!terminalToken) {
    return (
      <Screen className="gap-4 py-4" title={t`Operators`} onBack={router.back}>
        <Muted>
          {t`This tablet is not a shared terminal yet. Turn it on from More.`}
        </Muted>
        <Button
          variant="secondary"
          onPress={() => router.replace("/(app)/(tabs)/more")}
        >
          {t`Open More`}
        </Button>
      </Screen>
    );
  }

  const submit = async (candidate: string) => {
    if (!selected) return;
    setPin("");
    try {
      await pinIn.mutateAsync({ userId: selected.userId, pin: candidate });
      toast.success(t`Pinned in as ${selected.name}`);
      router.back();
    } catch (error) {
      // The server's own words: rate limited, locked out, wrong PIN, no PIN
      // set. Each is a different thing for the operator to do about it.
      toast.error(commandMessage(error, t`That PIN was not accepted`));
    }
  };

  const press = (key: string) => {
    if (key === "del") {
      setPin((value) => value.slice(0, -1));
      return;
    }
    if (!key) return;
    setPin((value) => {
      const next = value.length < MAX_PIN ? value + key : value;
      // Submits as soon as it CAN be valid, like every PIN pad: a separate
      // Enter is one more thing to find with a part in the other hand. A
      // longer PIN is still possible — the operator keeps typing.
      return next;
    });
  };

  return (
    <Screen
      className="gap-4 py-4"
      title={selected ? selected.name : t`Operators`}
      onBack={selected ? () => setSelected(null) : () => router.back()}
      scroll={!selected}
    >
      {!selected ? (
        <>
          {operator ? (
            <Card className="gap-3">
              <View className="gap-1">
                <Muted className="text-sm">{t`Working as`}</Muted>
                <Body className="font-semibold">{operator.name}</Body>
              </View>
              <Button
                variant="destructive"
                loading={pinOut.isPending}
                onPress={async () => {
                  await pinOut.mutateAsync();
                  toast.success(t`Pinned out`);
                  router.back();
                }}
              >
                {t`Pin out`}
              </Button>
            </Card>
          ) : null}

          <Heading>{t`Who is working?`}</Heading>

          {operators.isLoading ? (
            <View className="gap-2">
              <Skeleton className="h-[64px]" />
              <Skeleton className="h-[64px]" />
              <Skeleton className="h-[64px]" />
            </View>
          ) : operators.isError ? (
            <ErrorNote>{t`Could not load the operator list.`}</ErrorNote>
          ) : (operators.data ?? []).length === 0 ? (
            <EmptyState
              title={t`No operators have a PIN`}
              description={t`PINs are set per employee in the ERP, under People.`}
            />
          ) : (
            <View className="gap-2">
              {(operators.data ?? []).map((person) => (
                <Pressable
                  key={person.userId}
                  onPress={() => {
                    setSelected(person);
                    setPin("");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t`Pin in as ${person.name}`}
                  className="min-h-[64px] justify-center rounded-lg border border-border bg-card px-4 active:opacity-70"
                >
                  <Body className="font-semibold">{person.name}</Body>
                </Pressable>
              ))}
            </View>
          )}
        </>
      ) : (
        <View className="flex-1 items-center gap-6">
          <Muted>{t`Enter your PIN`}</Muted>

          {/* Dots, not the digits. A PIN pad on a shop floor is read over a
              shoulder, and the count is all the operator needs to confirm. */}
          <View
            className="flex-row gap-3"
            accessibilityRole="text"
            accessibilityLabel={t`${pin.length} digits entered`}
          >
            {Array.from({ length: Math.max(MIN_PIN, pin.length) }).map(
              (_, index) => (
                <View
                  key={`dot-${index}`}
                  className={`size-4 rounded-full ${
                    index < pin.length ? "bg-foreground" : "bg-muted"
                  }`}
                />
              )
            )}
          </View>

          <View className="w-full max-w-[320px] flex-row flex-wrap">
            {KEYS.map((key, index) => (
              <View
                key={key || `gap-${index}`}
                className="w-1/3 items-center p-2"
              >
                {key ? (
                  <Pressable
                    onPress={() => press(key)}
                    disabled={pinIn.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={key === "del" ? t`Delete` : key}
                    className={`size-[72px] items-center justify-center rounded-full border border-border bg-card ${
                      pinIn.isPending ? "opacity-40" : "active:opacity-60"
                    }`}
                  >
                    {key === "del" ? (
                      <Delete size={28} color={colors.foreground} />
                    ) : (
                      <Text className="text-3xl font-semibold text-foreground">
                        {key}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>

          <Button
            className="w-full max-w-[320px]"
            disabled={pin.length < MIN_PIN}
            loading={pinIn.isPending}
            onPress={() => void submit(pin)}
          >
            {pin.length < MIN_PIN
              ? t`Enter at least ${MIN_PIN} digits`
              : t`Pin in`}
          </Button>
        </View>
      )}
    </Screen>
  );
}
