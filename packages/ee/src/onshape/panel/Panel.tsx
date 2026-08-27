import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  HStack,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useState } from "react";
import type { OnshapeClientMessage, OnshapePanelContext } from "./messages";
import {
  isOnshapeClientMessage,
  isPanelSessionMessage,
  postApplicationInit
} from "./messages";
import {
  clearPanelSessionToken,
  getPanelSessionToken,
  PanelUnauthorizedError,
  panelFetch,
  setPanelSessionToken
} from "./session-storage";
import type { PanelPartStatus } from "./status";

export type PanelAssemblyLine = {
  index: string;
  level: number;
  partNumber: string | null;
  name: string | null;
  quantity: number;
  purchased: boolean;
  state: "matched" | "missing";
  itemId: string | null;
};

export type PanelAssemblyStatus = {
  root: {
    partNumber: string | null;
    name: string | null;
    state: "linked" | "matched" | "missing";
    itemId: string | null;
    lastSyncedAt: string | null;
  };
  lines: PanelAssemblyLine[];
};

type PanelStatusState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; rows: PanelPartStatus[] }
  | { status: "ready-assembly"; assembly: PanelAssemblyStatus }
  | { status: "ready-other" }
  | { status: "error"; message: string };

export type OnshapePanelPaths = {
  /** Popup route that mints a panel session for the signed-in user. */
  auth: string;
  /** Returns who the token belongs to. */
  me: string;
  /** DELETE revokes the token. */
  session: string;
  /** Carbon status for the current element's parts. */
  status: string;
  /** POST: push parts of the current element into Carbon. */
  pushPart: string;
  /** POST: push the current assembly (items + BOM) into Carbon. */
  pushAssembly: string;
};

export type OnshapePanelMe = {
  userId: string;
  email: string;
  company: { id: string; name: string } | null;
};

type SessionState =
  | { status: "unknown" }
  | { status: "signed-out" }
  | { status: "loading"; token: string }
  | { status: "signed-in"; token: string; me: OnshapePanelMe }
  | { status: "error"; token: string | null; message: string };

/**
 * The Carbon panel Onshape embeds in its element right panel.
 *
 * Phase 1 M1: proves the three legs — Onshape context arrives on the URL,
 * Onshape's SELECTION messages arrive over postMessage, and a Carbon user can
 * sign in from inside the iframe through a same-origin popup. Later milestones
 * replace the selection debug block with part status and push controls.
 */
export function OnshapePanel({
  context,
  serverOrigin,
  paths
}: {
  context: OnshapePanelContext;
  serverOrigin: string | null;
  paths: OnshapePanelPaths;
}) {
  const [session, setSession] = useState<SessionState>({ status: "unknown" });
  const [lastMessage, setLastMessage] = useState<OnshapeClientMessage | null>(
    null
  );
  const [messageCount, setMessageCount] = useState(0);
  const [parts, setParts] = useState<PanelStatusState>({ status: "idle" });

  const canLoadParts =
    !!context.documentId &&
    !!context.wv &&
    !!context.wvId &&
    !!context.elementId;
  const canPush = canLoadParts && (context.wv === "w" || context.wv === "v");
  const [pushing, setPushing] = useState<Set<string> | null>(null);
  const [pushOutcome, setPushOutcome] = useState<Record<string, string>>({});

  const loadParts = useCallback(
    async (token: string) => {
      if (!canLoadParts) return;
      setParts({ status: "loading" });
      try {
        const query = new URLSearchParams({
          documentId: context.documentId as string,
          wv: context.wv as string,
          wvId: context.wvId as string,
          elementId: context.elementId as string
        });
        const response = await panelFetch(token, `${paths.status}?${query}`);
        const body = (await response.json()) as
          | { parts: PanelPartStatus[] }
          | { error: string };
        if (!response.ok || "error" in body) {
          setParts({
            status: "error",
            message:
              "error" in body
                ? body.error
                : `Carbon answered ${response.status}`
          });
          return;
        }
        setParts({ status: "ready", rows: body.parts });
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          setParts({ status: "idle" });
          return;
        }
        setParts({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [canLoadParts, context, paths.status]
  );

  const loadMe = useCallback(
    async (token: string) => {
      setSession({ status: "loading", token });
      try {
        const response = await panelFetch(token, paths.me);
        if (!response.ok) {
          setSession({
            status: "error",
            token,
            message: `Carbon answered ${response.status}`
          });
          return;
        }
        const me = (await response.json()) as OnshapePanelMe;
        setSession({ status: "signed-in", token, me });
        void loadParts(token);
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setSession({
          status: "error",
          token,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [paths.me, loadParts]
  );

  // Boot: tell Onshape we are ready, restore a stored token, and listen for
  // both Onshape (selection) and our own popup (session token).
  useEffect(() => {
    if (serverOrigin) postApplicationInit(context, serverOrigin);

    const stored = getPanelSessionToken();
    if (stored) {
      void loadMe(stored);
    } else {
      setSession({ status: "signed-out" });
    }

    const onMessage = (event: MessageEvent) => {
      if (serverOrigin && event.origin === serverOrigin) {
        if (isOnshapeClientMessage(event.data)) {
          setLastMessage(event.data);
          setMessageCount((n) => n + 1);
        }
        return;
      }
      if (
        event.origin === window.location.origin &&
        isPanelSessionMessage(event.data)
      ) {
        setPanelSessionToken(event.data.token);
        void loadMe(event.data.token);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [context, serverOrigin, loadMe]);

  const pushParts = useCallback(
    async (token: string, partIds: string[]) => {
      if (!canPush || partIds.length === 0) return;
      setPushing(new Set(partIds));
      try {
        const response = await panelFetch(token, paths.pushPart, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: context.documentId,
            wv: context.wv,
            wvId: context.wvId,
            elementId: context.elementId,
            partIds
          })
        });
        const body = (await response.json()) as
          | {
              results: Array<{
                partId: string;
                action: string;
                message?: string;
              }>;
            }
          | { error: string };
        if (!response.ok || "error" in body) {
          const message =
            "error" in body ? body.error : `Carbon answered ${response.status}`;
          setPushOutcome(
            Object.fromEntries(partIds.map((id) => [id, message]))
          );
          return;
        }
        setPushOutcome((prev) => ({
          ...prev,
          ...Object.fromEntries(
            body.results.map((r) => [
              r.partId,
              r.action === "created"
                ? "Created — model syncing"
                : r.action === "adopted"
                  ? "Linked to existing item — model syncing"
                  : r.action === "updated"
                    ? "Updated — model syncing"
                    : r.action === "unchanged"
                      ? "Already up to date"
                      : (r.message ?? r.action)
            ])
          )
        }));
        await loadParts(token);
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setPushOutcome(Object.fromEntries(partIds.map((id) => [id, message])));
      } finally {
        setPushing(null);
      }
    },
    [canPush, context, paths.pushPart, loadParts]
  );

  const [assemblyOutcome, setAssemblyOutcome] = useState<string | null>(null);
  const pushAssembly = useCallback(
    async (token: string) => {
      if (!canPush) return;
      setPushing(new Set(["__assembly__"]));
      setAssemblyOutcome(null);
      try {
        const response = await panelFetch(token, paths.pushAssembly, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: context.documentId,
            wv: context.wv,
            wvId: context.wvId,
            elementId: context.elementId
          })
        });
        const body = (await response.json()) as
          | {
              summary: {
                itemsCreated: number;
                itemsReused: number;
                linesWritten: number;
                methodsTouched: number;
                skipped: string[];
                errors: string[];
              };
            }
          | { error: string };
        if (!response.ok || "error" in body) {
          setAssemblyOutcome(
            "error" in body ? body.error : `Carbon answered ${response.status}`
          );
          return;
        }
        const s = body.summary;
        const problems = [...s.errors, ...s.skipped];
        setAssemblyOutcome(
          `${s.itemsCreated} items created, ${s.itemsReused} reused, ` +
            `${s.linesWritten} BOM lines across ${s.methodsTouched} methods — model syncing` +
            (problems.length > 0 ? ` · ${problems.join(" · ")}` : "")
        );
        await loadParts(token);
      } catch (error) {
        if (error instanceof PanelUnauthorizedError) {
          setSession({ status: "signed-out" });
          return;
        }
        setAssemblyOutcome(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        setPushing(null);
      }
    },
    [canPush, context, paths.pushAssembly, loadParts]
  );

  const signIn = () => {
    const width = 480;
    const height = 680;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 3);
    const popup = window.open(
      paths.auth,
      "carbon-onshape-auth",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`
    );
    if (!popup) {
      setSession({
        status: "error",
        token: null,
        message:
          "The sign-in window was blocked. Allow pop-ups for this page and try again."
      });
    }
  };

  const signOut = async () => {
    const token = "token" in session ? session.token : null;
    clearPanelSessionToken();
    setSession({ status: "signed-out" });
    if (token) {
      try {
        await panelFetch(token, paths.session, { method: "DELETE" });
      } catch {
        // Already gone server-side; nothing to do.
      }
    }
  };

  return (
    <VStack spacing={4} className="p-4 max-w-2xl">
      <HStack className="justify-between w-full">
        <HStack spacing={2}>
          <img
            src="/carbon-mark-light.svg"
            alt=""
            className="h-6 w-auto dark:hidden"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt=""
            className="h-6 w-auto hidden dark:block"
          />
          <span className="text-lg font-semibold">Carbon</span>
        </HStack>
        {session.status === "signed-in" ? (
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        ) : null}
      </HStack>

      {!serverOrigin ? (
        <Alert variant="destructive">
          <AlertTitle>Open this panel from Onshape</AlertTitle>
          <AlertDescription>
            This page only works inside Onshape's right panel, which supplies
            the document context and a trusted origin.
          </AlertDescription>
        </Alert>
      ) : null}

      <ContextSummary context={context} />

      {session.status === "signed-out" || session.status === "unknown" ? (
        <VStack spacing={2}>
          <p className="text-sm text-muted-foreground">
            Sign in to Carbon to see what this document has in Carbon and to
            push parts, assemblies and releases.
          </p>
          <Button onClick={signIn} isDisabled={session.status === "unknown"}>
            Sign in to Carbon
          </Button>
        </VStack>
      ) : null}

      {session.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Connecting to Carbon…</p>
      ) : null}

      {session.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Carbon is not reachable</AlertTitle>
          <AlertDescription>{session.message}</AlertDescription>
          <HStack className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => session.token && loadMe(session.token)}
            >
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut}>
              Sign in again
            </Button>
          </HStack>
        </Alert>
      ) : null}

      {session.status === "signed-in" ? (
        <VStack spacing={1}>
          <HStack spacing={2}>
            <Badge variant="green">Connected</Badge>
            <span className="text-sm">
              {session.me.email}
              {session.me.company ? ` · ${session.me.company.name}` : ""}
            </span>
          </HStack>
        </VStack>
      ) : null}

      {session.status === "signed-in" &&
      canLoadParts &&
      (parts.status === "ready-assembly" || parts.status === "ready-other") ? (
        parts.status === "ready-assembly" ? (
          <AssemblySection
            assembly={parts.assembly}
            canPush={canPush}
            busy={!!pushing}
            outcome={assemblyOutcome}
            onPush={() => pushAssembly(session.token)}
            onRefresh={() => loadParts(session.token)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            This element type has nothing to push. Open a Part Studio or an
            assembly.
          </p>
        )
      ) : null}

      {session.status === "signed-in" &&
      canLoadParts &&
      parts.status !== "ready-assembly" &&
      parts.status !== "ready-other" ? (
        <PartsSection
          parts={parts}
          canPush={canPush}
          pushing={pushing}
          pushOutcome={pushOutcome}
          onRefresh={() => loadParts(session.token)}
          onPush={(partIds) => pushParts(session.token, partIds)}
        />
      ) : null}

      <details className="w-full text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Onshape messages ({messageCount})
        </summary>
        <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-2">
          {lastMessage
            ? JSON.stringify(lastMessage, null, 2)
            : "No message received yet. Select something in Onshape."}
        </pre>
      </details>
    </VStack>
  );
}

function AssemblySection({
  assembly,
  canPush,
  busy,
  outcome,
  onPush,
  onRefresh
}: {
  assembly: PanelAssemblyStatus;
  canPush: boolean;
  busy: boolean;
  outcome: string | null;
  onPush: () => void;
  onRefresh: () => void;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <HStack spacing={2}>
          <span className="text-sm font-medium">
            {assembly.root.partNumber ?? assembly.root.name ?? "Assembly"}
          </span>
          <PartStateBadge
            state={
              assembly.root.state === "linked" ? "linked" : assembly.root.state
            }
          />
        </HStack>
        <HStack spacing={1}>
          {canPush ? (
            <Button
              size="sm"
              onClick={onPush}
              isDisabled={busy}
              isLoading={busy}
            >
              {assembly.root.state === "linked"
                ? "Re-push assembly"
                : "Push assembly"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            isDisabled={busy}
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      {!assembly.root.partNumber ? (
        <Alert variant="destructive">
          <AlertTitle>The assembly has no part number</AlertTitle>
          <AlertDescription>
            Set a part number on the assembly in Onshape, then push.
          </AlertDescription>
        </Alert>
      ) : null}

      {outcome ? (
        <p className="text-xs text-muted-foreground w-full">{outcome}</p>
      ) : null}

      {assembly.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">The BOM is empty.</p>
      ) : (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {assembly.lines.map((line) => (
            <li
              key={line.index}
              className="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <div
                className="min-w-0"
                style={{ paddingLeft: `${(line.level - 1) * 16}px` }}
              >
                <p className="text-sm truncate">
                  {line.name ?? line.partNumber ?? line.index}
                  <span className="text-muted-foreground">
                    {" "}
                    × {line.quantity}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {line.partNumber ?? "No part number"}
                  {line.purchased ? " · purchased" : ""}
                </p>
              </div>
              <PartStateBadge state={line.state} />
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}

function PartsSection({
  parts,
  canPush,
  pushing,
  pushOutcome,
  onRefresh,
  onPush
}: {
  parts:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; rows: PanelPartStatus[] }
    | { status: "error"; message: string };
  canPush: boolean;
  pushing: Set<string> | null;
  pushOutcome: Record<string, string>;
  onRefresh: () => void;
  onPush: (partIds: string[]) => void;
}) {
  // Defensive against a half-migrated state shape (stale HMR closures can
  // deliver ready without rows): never crash the panel over it.
  const rows =
    parts.status === "ready" && Array.isArray(parts.rows) ? parts.rows : [];
  const pushableIds = rows.filter((r) => r.partNumber).map((r) => r.partId);
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">Parts in this element</span>
        <HStack spacing={1}>
          {canPush && pushableIds.length > 0 ? (
            <Button
              size="sm"
              onClick={() => onPush(pushableIds)}
              isDisabled={!!pushing || parts.status === "loading"}
              isLoading={!!pushing && pushing.size > 1}
            >
              Push all
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            isDisabled={parts.status === "loading" || !!pushing}
          >
            Refresh
          </Button>
        </HStack>
      </HStack>

      {parts.status === "loading" || parts.status === "idle" ? (
        <p className="text-sm text-muted-foreground">Loading parts…</p>
      ) : null}

      {parts.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load part status</AlertTitle>
          <AlertDescription>{parts.message}</AlertDescription>
        </Alert>
      ) : null}

      {parts.status === "ready" && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This element has no parts.
        </p>
      ) : null}

      {parts.status === "ready" && rows.length > 0 ? (
        <ul className="w-full divide-y divide-border rounded-md border border-border">
          {rows.map((part) => (
            <li
              key={part.partId}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm truncate">{part.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {part.partNumber ?? "No part number"}
                  {part.revision ? ` · Rev ${part.revision}` : ""}
                  {part.state === "linked" && part.item
                    ? ` → ${part.item.readableId}`
                    : ""}
                  {part.state === "matched" && part.item
                    ? ` · matches ${part.item.readableId}`
                    : ""}
                </p>
              </div>
              <HStack spacing={2} className="shrink-0">
                {pushOutcome[part.partId] ? (
                  <span className="text-xs text-muted-foreground">
                    {pushOutcome[part.partId]}
                  </span>
                ) : null}
                <PartStateBadge state={part.state} />
                {canPush ? (
                  <Button
                    size="sm"
                    variant={part.state === "linked" ? "ghost" : "secondary"}
                    onClick={() => onPush([part.partId])}
                    isDisabled={!!pushing || !part.partNumber}
                    isLoading={!!pushing && pushing.has(part.partId)}
                    title={
                      part.partNumber
                        ? undefined
                        : "Set a part number in Onshape first"
                    }
                  >
                    {part.state === "linked" ? "Re-push" : "Push"}
                  </Button>
                ) : null}
              </HStack>
            </li>
          ))}
        </ul>
      ) : null}
    </VStack>
  );
}

function PartStateBadge({ state }: { state: PanelPartStatus["state"] }) {
  if (state === "linked") return <Badge variant="green">In Carbon</Badge>;
  if (state === "matched") return <Badge variant="yellow">Match found</Badge>;
  return <Badge variant="secondary">Not in Carbon</Badge>;
}

function ContextSummary({ context }: { context: OnshapePanelContext }) {
  const rows: Array<[string, string | null]> = [
    ["Document", context.documentId],
    [
      context.wv === "v"
        ? "Version"
        : context.wv === "m"
          ? "Microversion"
          : "Workspace",
      context.wvId
    ],
    ["Element", context.elementId],
    ["Part number", context.partNumber],
    ["Revision", context.revision],
    ["Configuration", context.configuration]
  ];

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs w-full">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono break-all">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
