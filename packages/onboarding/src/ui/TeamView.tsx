import { Trans, useLingui } from "@lingui/react/macro";
import { LuUser } from "react-icons/lu";
import { PAGE_COPY } from "../content";
import { TEAM_ROLES } from "../content/team";
import { PageHeader } from "./primitives";
import { useContacts } from "./state";

export function TeamView() {
  const { t, i18n } = useLingui();
  const contacts = useContacts();

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      <PageHeader
        title={i18n._(PAGE_COPY.team.title)}
        lead={i18n._(PAGE_COPY.team.lead)}
      />

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-primary mb-1">
          <Trans>Your main point of contact</Trans>
        </div>
        <p className="text-sm">
          <Trans>Start with</Trans>{" "}
          <span className="font-semibold">
            {contacts.owner ?? t`your Implementation Lead`}
          </span>{" "}
          <Trans>for anything. They'll pull in the right person.</Trans>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {TEAM_ROLES.map((member, i) => (
          <div
            key={i}
            className="rounded-2xl border bg-card shadow-button-base p-5 flex items-start gap-4"
          >
            <span className="shrink-0 size-10 rounded-full border bg-background flex items-center justify-center">
              <LuUser className="text-muted-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">{i18n._(member.role)}</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                <Trans>Owns: {i18n._(member.owns)}</Trans>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
