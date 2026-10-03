// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { forwardRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import {
  Body,
  Button,
  ErrorNote,
  Field,
  Muted,
  Skeleton
} from "~/components/ui";
import { commandMessage, useRaiseQualityIssue } from "./commands";
import type { ReportTarget } from "./logic";
import { useQualityIssueTypes } from "./useLookups";

/**
 * Raise a non-conformance against this operation.
 *
 * The one action in this app that needs a permission beyond "employee of the
 * company" — the web route gates on `quality` create, and parity with the web
 * is the rule. An operator without it gets a 403, and the sheet reports the
 * server's own message in place rather than the control having been hidden:
 * someone standing at a bad part needs to know whether to fetch a supervisor,
 * not to wonder where the button went.
 */
export const QualityIssueSheet = forwardRef<
  SheetHandle,
  { target: ReportTarget; onClose: () => void }
>(function QualityIssueSheet({ target, onClose }, ref) {
  const { t } = useLingui();
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const types = useQualityIssueTypes(true);
  const raise = useRaiseQualityIssue(target.operationId);

  const submit = async () => {
    const text = description.trim();
    if (!text) return;
    try {
      const result = await raise.mutateAsync({
        description: text,
        nonConformanceTypeId: typeId ?? undefined,
        trackedEntityId: target.trackedEntityId
      });
      onClose();
      setDescription("");
      setTypeId(null);
      toast.success(
        result.readableId
          ? t`Raised ${result.readableId}`
          : t`Quality issue raised`
      );
    } catch (error) {
      toast.error(commandMessage(error, t`Could not raise the issue`));
    }
  };

  return (
    <Sheet ref={ref} title={t`Raise a quality issue`}>
      <View className="gap-4 px-2 pt-2">
        <View className="gap-2">
          <Muted className="text-sm">{t`What kind of problem is it?`}</Muted>
          {types.isLoading ? (
            <Skeleton className="h-[56px]" />
          ) : types.isError ? (
            <ErrorNote>{t`Could not load the issue types.`}</ErrorNote>
          ) : (
            <ScrollView className="max-h-[200px]">
              <View className="gap-2">
                {(types.data ?? []).map((type) => {
                  const selected = type.id === typeId;
                  return (
                    <Pressable
                      key={type.id}
                      onPress={() => setTypeId(type.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className={`min-h-[56px] justify-center rounded-lg border px-4 ${
                        selected
                          ? "border-primary bg-muted"
                          : "border-border bg-card active:opacity-70"
                      }`}
                    >
                      <Body className={selected ? "font-semibold" : ""}>
                        {type.name}
                      </Body>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>

        <Field
          label={t`What happened?`}
          value={description}
          onChangeText={setDescription}
          placeholder={t`Describe what you found`}
          multiline
        />

        <Button
          onPress={submit}
          disabled={!description.trim()}
          loading={raise.isPending}
        >
          {t`Raise the issue`}
        </Button>
      </View>
    </Sheet>
  );
});
