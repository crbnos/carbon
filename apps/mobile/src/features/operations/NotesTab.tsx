// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail } from "@carbon/mes-core";
import { formatDateTime } from "@carbon/utils/date";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { toast } from "sonner-native";
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Muted,
  Skeleton
} from "~/components/ui";
import { commandMessage, useAddNote } from "./commands";
import { useOperationNotes } from "./useNotes";

/**
 * The operation's notes — what the last shift left for this one.
 *
 * The composer sits at the BOTTOM, under the notes, because that is where the
 * newest note is and where a thumb already is. Posting keeps the operator on
 * the operation, like every other action here.
 *
 * Timestamps go through `formatDateTime`, not `new Date(...)`: `createdAt` is
 * an instant, and parsing it with `Date` is what puts a note on the wrong day
 * for anyone west of UTC.
 */
export function NotesTab({ detail }: { detail: OperationDetail }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const notes = useOperationNotes(detail.operation.id);
  const add = useAddNote(detail.operation.id);
  const [draft, setDraft] = useState("");

  const post = async () => {
    const note = draft.trim();
    if (!note) return;
    try {
      await add.mutateAsync(note);
      setDraft("");
      await notes.refetch();
    } catch (error) {
      // The draft is deliberately left in the field: an operator who typed a
      // paragraph on a tablet must not lose it to a dropped connection.
      toast.error(commandMessage(error, t`Could not post that note`));
    }
  };

  return (
    <View className="flex-1">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pb-4 pt-2"
      >
        {notes.isLoading ? (
          <View className="gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </View>
        ) : notes.isError ? (
          <ErrorNote>{t`Could not load the notes.`}</ErrorNote>
        ) : (notes.data ?? []).length === 0 ? (
          <EmptyState
            title={t`No notes yet`}
            description={t`Anything you add here is what the next shift reads.`}
          />
        ) : (
          (notes.data ?? []).map((note) => (
            <Card key={note.id} className="gap-2">
              <Body>{note.note ?? ""}</Body>
              {note.createdAt ? (
                <Muted className="text-sm">
                  {formatDateTime(note.createdAt, locale)}
                </Muted>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>

      <View className="gap-2 border-t border-border bg-card px-4 py-3">
        <Field
          label={t`Add a note`}
          value={draft}
          onChangeText={setDraft}
          placeholder={t`What should the next person know?`}
          multiline
        />
        <Button onPress={post} disabled={!draft.trim()} loading={add.isPending}>
          {t`Post note`}
        </Button>
      </View>
    </View>
  );
}
