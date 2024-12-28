import { ValidatedForm } from "@carbon/form";
import { Button, HStack, VStack } from "@carbon/react";
import { HTML } from "@carbon/react/HTML";
import { formatTimeAgo } from "@carbon/utils";
import { Form } from "@remix-run/react";
import { Fragment } from "react";
import { Avatar } from "~/components";
import { Hidden, Submit } from "~/components/Form";
import RichTextForm from "~/components/Form/RichText";
import { usePermissions, useUser } from "~/hooks";
import type { Note } from "~/modules/shared";
import { noteValidator } from "~/modules/shared";
import { path } from "~/utils/path";

type RichTextProps = {
  documentId: string;
  notes: Note[];
};

const RichText = ({ documentId, notes }: RichTextProps) => {
  const user = useUser();
  const permissions = usePermissions();
  const isEmployee = permissions.is("employee");

  if (!isEmployee) return null;

  return (
    <>
      {notes.length > 0 ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-8 w-full">
          {notes.map((note) => {
            if (!note.user || Array.isArray(note.user))
              throw new Error("Invalid user");
            return (
              <Fragment key={note.id}>
                {/* @ts-ignore */}
                <Avatar path={note.user.avatarUrl} name={note.user?.fullName} />
                <VStack spacing={1}>
                  {/* @ts-ignore */}
                  <p className="font-bold">{note.user?.fullName!}</p>
                  <HTML text={note.note} />
                  <HStack spacing={4}>
                    <span className="text-sm text-muted-foreground">
                      {formatTimeAgo(note.createdAt)}
                    </span>
                    {/* @ts-ignore */}
                    {user.id === note.user.id && (
                      <Form method="post" action={path.to.deleteNote(note.id)}>
                        <Button type="submit" variant="link" size="md">
                          Delete
                        </Button>
                      </Form>
                    )}
                  </HStack>
                </VStack>
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground p-4 w-full text-center">
          No notes
        </div>
      )}

      <div className="pt-8 w-full">
        <ValidatedForm
          method="post"
          action={path.to.newNote}
          resetAfterSubmit
          validator={noteValidator}
        >
          <Hidden name="documentId" value={documentId} />
          <VStack spacing={3}>
            <div className="w-full border border-border rounded-md">
              <RichTextForm name="note" className="min-h-[160px]" />
            </div>
            <div className="flex justify-end w-full">
              <Submit>Add Note</Submit>
            </div>
          </VStack>
        </ValidatedForm>
      </div>
    </>
  );
};

export default RichText;
