import { LuUser } from "react-icons/lu";
import { PAGE_COPY } from "../content";
import { TEAM_ROLES } from "../content/team";
import { PageHeader } from "./primitives";
import { useContacts } from "./state";

export function TeamView() {
  const contacts = useContacts();

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader title={PAGE_COPY.team.title} lead={PAGE_COPY.team.lead} />

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-primary mb-1">
          Your main point of contact
        </div>
        <p className="text-sm">
          Start with{" "}
          <span className="font-semibold">
            {contacts.owner ?? "your Implementation Lead"}
          </span>{" "}
          for anything. They'll pull in the right person.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {TEAM_ROLES.map((member) => (
          <div
            key={member.role}
            className="rounded-2xl border bg-card shadow-button-base p-5 flex items-start gap-4"
          >
            <span className="shrink-0 size-10 rounded-full border bg-background flex items-center justify-center">
              <LuUser className="text-muted-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">{member.role}</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                Owns: {member.owns}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
