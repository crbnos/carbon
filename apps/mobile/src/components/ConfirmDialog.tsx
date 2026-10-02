// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { Body, Button, Heading, Muted } from "./ui";

/**
 * A confirmation says what will be affected, and names it.
 *
 * "Finish this operation?" is a question an operator cannot answer; "Finish
 * this operation? Two timers will be closed: Setup 00:14:02, Labor 01:22:40"
 * is. So `affected` is a real parameter, not a slot for prose.
 *
 * Cancel sits LEFT and the action RIGHT, both full-height, because a thumb
 * reaching across a tablet should land on the safe one when it misses.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  affected,
  confirmLabel,
  cancelLabel,
  tone = "default",
  pending = false,
  onConfirm,
  onCancel,
  children
}: {
  open: boolean;
  title: string;
  description?: string;
  /** One line per thing this will change. Rendered as a list. */
  affected?: string[];
  confirmLabel: string;
  cancelLabel: string;
  tone?: "default" | "destructive";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      // Android's hardware back must be Cancel, not a silent confirm.
      onRequestClose={onCancel}
    >
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <View className="w-full max-w-[520px] gap-4 rounded-2xl border border-border bg-card p-6">
          <Heading>{title}</Heading>
          {description ? <Muted>{description}</Muted> : null}

          {affected?.length ? (
            <ScrollView className="max-h-[200px]">
              <View className="gap-2 rounded-lg bg-muted p-3">
                {affected.map((line) => (
                  <Body key={line} className="text-sm">
                    {line}
                  </Body>
                ))}
              </View>
            </ScrollView>
          ) : null}

          {children}

          <View className="flex-row gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onPress={onCancel}
              disabled={pending}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={tone === "destructive" ? "destructive" : "primary"}
              className="flex-1"
              onPress={onConfirm}
              loading={pending}
            >
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
