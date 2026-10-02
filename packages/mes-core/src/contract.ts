// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";
import { pickingListStatus } from "./models";

/**
 * The wire contract between the Carbon MES mobile app and the MES API
 * (`apps/mes/app/routes/api+/v1+/`). Both sides import these schemas, so a
 * server response the app's zod would reject fails the server's own tests first.
 *
 * `/api/v1` is ADDITIVE-ONLY (BACKWARD_COMPATIBILITY.md). A breaking change
 * needs `/api/v2`, and v1 stays until the oldest supported app release stops
 * using it.
 */
/**
 * An http(s) URL. `z.string().url()` delegates to `new URL`, which happily
 * accepts "localhost:54321" (scheme "localhost:") and "carbon-mes://link" — so
 * it would pass a Supabase URL the app can never fetch from. Check the protocol.
 */
export const httpUrl = z.string().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "Must be an http or https URL" }
);

export const API_VERSION = 1 as const;
export const API_PREFIX = "/api/v1" as const;

/** Header names, lowercase — `Headers` lookups are case-insensitive either way. */
export const HEADERS = {
  /** The company every query is scoped to; checked against the caller's claims. */
  company: "x-carbon-company",
  /** The location whose work centers / printers the call acts on. */
  location: "x-carbon-location",
  /** Shared tablets: the signed operator token the command is attributed to. */
  operator: "x-carbon-operator",
  /** Shared tablets: the signed terminal token, sent only when pinning in. */
  terminal: "x-carbon-terminal",
  /** The app's own version, so the server can answer 426 to an old build. */
  appVersion: "x-carbon-app-version",
  /** Required on every authenticated POST; de-duplicates a retried command. */
  idempotencyKey: "idempotency-key",
  /** Set on a replayed response so the client can tell it apart from a fresh run. */
  idempotentReplayed: "idempotent-replayed",
  /** The API versions this server speaks, comma-separated. On EVERY response. */
  apiVersions: "carbon-api"
} as const;

export type ApiErrorCode =
  | "validation_failed"
  | "invalid_token"
  | "token_expired"
  | "mfa_required"
  | "operator_expired"
  | "company_required"
  | "location_required"
  | "forbidden"
  | "sso_required"
  | "not_found"
  | "conflict"
  | "blocked"
  | "needs_acknowledgement"
  | "request_in_progress"
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "update_required"
  | "rate_limited"
  | "locked"
  | "retry_later"
  | "invalid_code"
  | "internal";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level validation messages, keyed by the body field name. */
    fields?: Record<string, string[]>;
    /** Extra payload a code defines — e.g. `unresolvedLines` for `blocked`. */
    details?: unknown;
  };
};

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.array(z.string())).optional(),
    details: z.unknown().optional()
  })
});

/**
 * Compare two dotted numeric versions. Missing parts count as 0, so "1.0" and
 * "1.0.0" are equal, and non-numeric parts count as 0 rather than NaN-ing the
 * comparison (an app version is only ever used to decide "too old to talk to").
 */
export function compareAppVersion(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    const va = Number.isNaN(na) ? 0 : na;
    const vb = Number.isNaN(nb) ? 0 : nb;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/** Does this server speak a version the app understands? */
export function serverSpeaksApiVersion(header: string | null): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((v) => v.trim())
    .includes(String(API_VERSION));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authCodeRequest = z.object({
  email: z.string().email()
});
export type AuthCodeRequest = z.infer<typeof authCodeRequest>;

/**
 * Always `{ ok: true }`, for an existing account and a non-existent one alike —
 * the endpoint must not reveal which emails exist. `method: "password"` appears
 * only for an allow-listed store-review account (`APP_REVIEW_EMAILS`).
 */
export const authCodeResponse = z.object({
  ok: z.literal(true),
  method: z.literal("password").optional()
});
export type AuthCodeResponse = z.infer<typeof authCodeResponse>;

const sixDigitCode = z
  .string()
  .regex(/^\d{6}$/, { message: "Enter the 6-digit code from your email" });

export const authVerifyRequest = z.object({
  email: z.string().email(),
  code: sixDigitCode
});
export type AuthVerifyRequest = z.infer<typeof authVerifyRequest>;

export const authSessionResponse = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  /** The user has a verified TOTP factor; the app must run `/auth/mfa` next. */
  mfaRequired: z.boolean()
});
export type AuthSessionResponse = z.infer<typeof authSessionResponse>;

/**
 * BOTH tokens, not just the access token: `verifyTotpChallenge`
 * (`@carbon/auth/mfa.server`) seeds an anon client with `auth.setSession`
 * before it challenges, so it needs the refresh token too.
 */
export const authMfaRequest = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  code: sixDigitCode
});
export type AuthMfaRequest = z.infer<typeof authMfaRequest>;

export const authPasswordRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});
export type AuthPasswordRequest = z.infer<typeof authPasswordRequest>;

// ---------------------------------------------------------------------------
// GET /me — everything the app learns about an instance once signed in
// ---------------------------------------------------------------------------

export const deploymentMode = z.enum(["connected", "airgapped"]);
export type DeploymentMode = z.infer<typeof deploymentMode>;

export const meInstance = z.object({
  name: z.string(),
  /** The PUBLIC Supabase URL — never SUPABASE_INTERNAL_URL. */
  supabaseUrl: httpUrl,
  supabaseAnonKey: z.string().min(1),
  mode: deploymentMode,
  controlledEnvironment: z.boolean(),
  idleLockMs: z.number(),
  minAppVersion: z.string(),
  /** Null on self-hosted, air-gapped and controlled installs: no phoning home. */
  analytics: z
    .object({ posthogKey: z.string().min(1), posthogHost: z.string().min(1) })
    .nullable()
});
export type MeInstance = z.infer<typeof meInstance>;

export const mePermissions = z.object({
  production: z.object({
    view: z.boolean(),
    create: z.boolean(),
    update: z.boolean()
  }),
  inventory: z.object({ view: z.boolean(), update: z.boolean() }),
  quality: z.object({ create: z.boolean() }),
  settings: z.object({ update: z.boolean() })
});
export type MePermissions = z.infer<typeof mePermissions>;

export const meResponse = z.object({
  instance: meInstance,
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable()
  }),
  companies: z.array(z.object({ id: z.string(), name: z.string() })),
  locations: z.array(
    z.object({ id: z.string(), name: z.string(), companyId: z.string() })
  ),
  defaultLocationId: z.string().nullable(),
  workCenters: z.array(
    z.object({ id: z.string(), name: z.string(), locationId: z.string() })
  ),
  /** Console mode is on for the company AND the PERMISSIONS feature is entitled. */
  consoleAvailable: z.boolean(),
  permissions: mePermissions
});
export type MeResponse = z.infer<typeof meResponse>;

// ---------------------------------------------------------------------------
// Screen reads
// ---------------------------------------------------------------------------

/**
 * The operations list query. `filter` carries the web's own `key:op:value`
 * strings unchanged, so the app and the web cookie encode a filter the same way.
 */
export const operationsQuery = z.object({
  workCenterIds: z.array(z.string()).default([]),
  filter: z.array(z.string()).default([])
});
export type OperationsQuery = z.infer<typeof operationsQuery>;

/**
 * The operations list, as the app reads it.
 *
 * Deliberately a SUBSET of what the web loader returns: the web feeds a Kanban
 * board with columns, processes, customers and filter metadata, while the app
 * renders cards. Every field here is one an operator scans for on a card
 * (`apps/mes/app/components/OperationsList.tsx`), and `.passthrough()` keeps a
 * newer server's extra fields from failing an older app build — `/api/v1` is
 * additive-only.
 */
export const operationCard = z
  .object({
    id: z.string(),
    jobReadableId: z.string().nullable().optional(),
    itemReadableId: z.string().nullable().optional(),
    itemDescription: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    deadlineType: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
    targetQuantity: z.number().nullable().optional(),
    quantityCompleted: z.number().nullable().optional(),
    quantityScrapped: z.number().nullable().optional(),
    quantityReworked: z.number().nullable().optional(),
    columnId: z.string().nullable().optional(),
    thumbnailPath: z.string().nullable().optional(),
    salesOrderReadableId: z.string().nullable().optional(),
    batchId: z.string().nullable().optional(),
    batchReadableId: z.string().nullable().optional(),
    batchSize: z.number().nullable().optional()
  })
  .passthrough();
export type OperationCard = z.infer<typeof operationCard>;

export const workCenterColumn = z
  .object({
    id: z.string(),
    title: z.string(),
    active: z.boolean().optional(),
    isBlocked: z.boolean().optional()
  })
  .passthrough();
export type WorkCenterColumn = z.infer<typeof workCenterColumn>;

export const operationsScreen = z
  .object({
    items: z.array(operationCard),
    columns: z.array(workCenterColumn),
    /** The operator's manning-board station, when they have one for today. */
    peopleStation: z
      .object({ workCenterId: z.string(), name: z.string() })
      .nullable(),
    availableTags: z.array(z.string())
  })
  .passthrough();
export type OperationsScreen = z.infer<typeof operationsScreen>;

/**
 * One operation, as the app reads it.
 *
 * A deliberate SUBSET with `.passthrough()`: the web payload carries ~21 keys
 * of DB-derived data for a Kanban-era UI, and an older app build must not fail
 * because a newer server added a field (`/api/v1` is additive-only). Every
 * field named here is one the operator screen renders or acts on.
 */
export const productionEvent = z
  .object({
    id: z.string(),
    type: z.enum(["Setup", "Labor", "Machine"]),
    startTime: z.string(),
    endTime: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    workCenterId: z.string().nullable().optional()
  })
  .passthrough();
export type ProductionEvent = z.infer<typeof productionEvent>;

export const operationDetail = z
  .object({
    operation: z
      .object({
        id: z.string(),
        description: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        operationQuantity: z.number().nullable().optional(),
        quantityComplete: z.number().nullable().optional(),
        quantityScrapped: z.number().nullable().optional(),
        quantityReworked: z.number().nullable().optional(),
        workCenterId: z.string().nullable().optional(),
        // `makeDurations` has already summed these, in milliseconds.
        setupDuration: z.number().nullable().optional(),
        laborDuration: z.number().nullable().optional(),
        machineDuration: z.number().nullable().optional(),
        operationDueDate: z.string().nullable().optional(),
        itemReadableId: z.string().nullable().optional(),
        itemDescription: z.string().nullable().optional(),
        thumbnailPath: z.string().nullable().optional()
      })
      .passthrough(),
    job: z
      .object({
        id: z.string().nullable().optional(),
        jobId: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        customerId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional()
      })
      .passthrough(),
    events: z.array(productionEvent),
    quantities: z.object({
      scrap: z.number(),
      production: z.number(),
      rework: z.number()
    }),
    /** Null unless the operation runs in a released batch (batch UI is web-only in v1). */
    batch: z.unknown().nullable(),
    /** The selected serial/batch unit, resolved by the server when it can be. */
    trackedEntityId: z.string().nullable().optional(),
    isFirstOperation: z.boolean(),
    workCenter: z
      .object({
        data: z
          .object({
            id: z.string(),
            name: z.string(),
            isBlocked: z.boolean().nullable().optional(),
            blockingDispatchReadableId: z.string().nullable().optional()
          })
          .passthrough()
          .nullable()
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough();
export type OperationDetail = z.infer<typeof operationDetail>;

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/**
 * One row of the picking screen, from the `pickingLists` view. Every column of
 * that view is nullable in the generated types, so everything but `id` is
 * nullable here too — `lineCount` / `completedLineCount` are aggregates and
 * come back as 0 on an empty list rather than absent.
 */
export const pickingListCard = z
  .object({
    id: z.string(),
    pickingListId: z.string().nullable().optional(),
    status: z.enum(pickingListStatus).nullable().optional(),
    locationId: z.string().nullable().optional(),
    locationName: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    lineCount: z.number().nullable().optional(),
    completedLineCount: z.number().nullable().optional(),
    assignee: z.string().nullable().optional()
  })
  .passthrough();
export type PickingListCard = z.infer<typeof pickingListCard>;

export const pickingScreen = z
  .object({
    pickingLists: z.array(pickingListCard)
  })
  .passthrough();
export type PickingScreen = z.infer<typeof pickingScreen>;

/**
 * One line of a picking list, as the app reads it.
 *
 * `availableQuantity` is computed by `get_picking_list_availability` (warehouse
 * on-hand including the unassigned bin) and is what drives the "No Stock"
 * warning — it is not a column. `trackedEntities` are the lots already chosen
 * for this line, so an unpick knows what to give back.
 *
 * A deliberate SUBSET with `.passthrough()`: the web select embeds the job,
 * operation, supersession and both storage units for a Kanban-era UI, and an
 * older app build must not fail because a newer server added a field.
 */
export const pickingListLine = z
  .object({
    id: z.string(),
    itemId: z.string(),
    pickingListId: z.string().nullable().optional(),
    jobOperationId: z.string().nullable().optional(),
    quantityToPick: z.number(),
    quantityPicked: z.number(),
    quantityReturned: z.number().nullable().optional(),
    status: z
      .enum(["Pending", "Picked", "Short", "Cancelled"])
      .nullable()
      .optional(),
    storageUnitId: z.string().nullable().optional(),
    toStorageUnitId: z.string().nullable().optional(),
    availableQuantity: z.number().nullable().optional(),
    item: z
      .object({
        name: z.string().nullable().optional(),
        readableId: z.string().nullable().optional(),
        unitOfMeasureCode: z.string().nullable().optional()
      })
      .passthrough()
      .nullable()
      .optional(),
    trackedEntities: z
      .array(
        z
          .object({
            trackedEntityId: z.string(),
            quantity: z.number(),
            quantityPicked: z.number().nullable().optional()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();
export type PickingListLine = z.infer<typeof pickingListLine>;

export const pickingListDetail = z
  .object({
    pickingList: z
      .object({
        id: z.string(),
        pickingListId: z.string().nullable().optional(),
        status: z.enum(pickingListStatus).nullable().optional(),
        locationId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        /** `lines` is `lines?.map(...)` on the server, so it can be absent. */
        lines: z.array(pickingListLine).optional()
      })
      .passthrough(),
    /**
     * Recommended lots per line id, in pick order. The web streams this in
     * after first paint; the API awaits it, so it is always present — empty
     * for an untracked list.
     */
    recommendations: z.record(
      z.string(),
      z.array(
        z
          .object({
            trackedEntityId: z.string(),
            readableId: z.string().nullable()
          })
          .passthrough()
      )
    )
  })
  .passthrough();
export type PickingListDetail = z.infer<typeof pickingListDetail>;

/** The expired-lot policy the operator's pick is judged against. */
export const expiredEntityPolicy = z.enum([
  "Warn",
  "Block",
  "BlockWithOverride"
]);
export type ExpiredEntityPolicy = z.infer<typeof expiredEntityPolicy>;

export const pickingTrackedOptions = z
  .object({
    entities: z.array(
      z
        .object({
          trackedEntityId: z.string(),
          readableId: z.string().nullable().optional(),
          availableQuantity: z.number().nullable().optional(),
          storageUnitId: z.string().nullable().optional(),
          storageUnitName: z.string().nullable().optional(),
          expirationDate: z.string().nullable().optional(),
          status: z.string().nullable().optional(),
          createdAt: z.string().nullable().optional()
        })
        .passthrough()
    ),
    /** Defaults to "Batch" when the item names no tracking type. */
    trackingType: z.string(),
    /** What is still owed on the line: `quantityToPick - quantityPicked`, floored at 0. */
    quantityRequired: z.number(),
    nearExpiryWarningDays: z.number(),
    expiredEntityPolicy,
    /** The configured pick order for the item at the line's location. */
    defaultOrder: z.enum(["Default", "FEFO", "FIFO", "LIFO"])
  })
  .passthrough();
export type PickingTrackedOptions = z.infer<typeof pickingTrackedOptions>;

// ---------------------------------------------------------------------------
// Time card
// ---------------------------------------------------------------------------

export const timeCardEntry = z
  .object({
    id: z.string(),
    employeeId: z.string(),
    clockIn: z.string(),
    /** Null while the entry is open — that IS the "clocked in" signal. */
    clockOut: z.string().nullable(),
    note: z.string().nullable().optional()
  })
  .passthrough();
export type TimeCardEntry = z.infer<typeof timeCardEntry>;

export const timecardScreen = z
  .object({
    entries: z.array(timeCardEntry),
    /** The entry the operator is currently clocked in on, if any. */
    openEntry: timeCardEntry.nullable(),
    /** 0 = this week, -1 = last week. Echoed back so the app can pin its header. */
    weekOffset: z.number(),
    /**
     * The window's Monday and Sunday as calendar days on the COMPANY calendar
     * (`YYYY-MM-DD`), so the header never shifts a day in another timezone.
     */
    weekStart: z.string(),
    weekEnd: z.string()
  })
  .passthrough();
export type TimecardScreen = z.infer<typeof timecardScreen>;

// ---------------------------------------------------------------------------
// Operation detail: materials, instructions, notes
// ---------------------------------------------------------------------------

/**
 * One line of the operation's bill of material, from the
 * `jobMaterialWithMakeMethodId` view the web reads.
 *
 * Nearly every column is nullable because it IS a view, not a table — the
 * generated types say so, and a schema that demanded `itemReadableId` would
 * reject a whole operation over one unnameable row.
 */
export const operationMaterial = z
  .object({
    id: z.string().nullable(),
    itemId: z.string().nullable(),
    itemReadableId: z.string().nullable().optional(),
    /**
     * The id without its revision suffix. A label printed before a revision
     * bump still names the same shelf part, so a scan matches on either.
     */
    itemReadableIdWithoutRevision: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    methodType: z.string().nullable().optional(),
    /** What the job plans to consume, including its scrap allowance. */
    estimatedQuantity: z.number().nullable().optional(),
    quantityIssued: z.number().nullable().optional(),
    quantityToIssue: z.number().nullable().optional(),
    unitOfMeasureCode: z.string().nullable().optional(),
    requiresSerialTracking: z.boolean().nullable().optional(),
    requiresBatchTracking: z.boolean().nullable().optional(),
    storageUnitName: z.string().nullable().optional(),
    /** Set when a supersession swapped this line; the column holds the OTHER item. */
    substitutedFromItemId: z.string().nullable().optional(),
    substitutionFactor: z.number().nullable().optional(),
    kit: z.boolean().nullable().optional()
  })
  .passthrough();
export type OperationMaterial = z.infer<typeof operationMaterial>;

export const procedureStepType = z.enum([
  "Value",
  "Measurement",
  "Checkbox",
  "Timestamp",
  "Person",
  "List",
  "File",
  "Task",
  "Inspection"
]);
export type ProcedureStepType = z.infer<typeof procedureStepType>;

/** What an operator has already recorded against a step, per unit. */
export const operationStepRecord = z
  .object({
    id: z.string(),
    jobOperationStepId: z.string(),
    /** The unit-axis position. One record per unit per step. */
    index: z.number(),
    value: z.string().nullable().optional(),
    numericValue: z.number().nullable().optional(),
    booleanValue: z.boolean().nullable().optional(),
    userValue: z.string().nullable().optional(),
    createdBy: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();
export type OperationStepRecord = z.infer<typeof operationStepRecord>;

export const operationStep = z
  .object({
    id: z.string(),
    name: z.string(),
    /**
     * Tiptap rich text, not a string. The app flattens it to plain text for
     * display — there is no rich-text renderer in the native bundle, and a
     * step whose instructions were silently blank would be worse than one
     * shown without its formatting.
     */
    description: z.unknown().nullable().optional(),
    type: procedureStepType,
    sortOrder: z.number(),
    required: z.boolean().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).nullable().optional(),
    unitOfMeasureCode: z.string().nullable().optional(),
    jobOperationStepRecord: z.array(operationStepRecord).nullable().optional()
  })
  .passthrough();
export type OperationStep = z.infer<typeof operationStep>;

export const operationProcedure = z
  .object({
    attributes: z.array(operationStep),
    parameters: z.array(z.unknown())
  })
  .passthrough();
export type OperationProcedure = z.infer<typeof operationProcedure>;

export const operationNote = z
  .object({
    id: z.string(),
    note: z.string().nullable().optional(),
    createdBy: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional()
  })
  .passthrough();
export type OperationNote = z.infer<typeof operationNote>;

// ---------------------------------------------------------------------------
// Console — the shared tablet
// ---------------------------------------------------------------------------

/**
 * A tablet clamped to a machine signs in ONCE as a terminal account; the
 * operators who use it pin in with their PIN, and their work is attributed to
 * them. Two tokens, both signed and verified server-side (`@carbon/auth`
 * `console-token.server`), carry that:
 *
 * - the TERMINAL token (`HEADERS.terminal`) says which tablet session is
 *   offering a PIN. It is bound to the company and the signed-in terminal
 *   account, and is sent only to `POST /console/pin-in`.
 * - the OPERATOR token (`HEADERS.operator`) IS the identity claim, sent with
 *   every call the operator makes. It expires, it is bound to the same company
 *   and terminal session, and the server re-validates the operator against the
 *   database on every request.
 *
 * The app keeps BOTH in memory only — never SecureStore, never the query cache
 * — so a stolen tablet carries no operator session and a cold start lands on
 * the PIN screen. Nothing on the server depends on the app persisting them.
 */
export const consoleTerminalResponse = z.object({
  terminalToken: z.string().min(1)
});
export type ConsoleTerminalResponse = z.infer<typeof consoleTerminalResponse>;

/** Who is pinned in, as the app renders it in the operator header. */
export const consoleOperator = z.object({
  userId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable()
});
export type ConsoleOperator = z.infer<typeof consoleOperator>;

export const consolePinInResponse = z.object({
  operatorToken: z.string().min(1),
  operator: consoleOperator,
  /**
   * When the claim lapses, as epoch ms — an hour, or the deployment's
   * `instance.idleLockMs` in a controlled environment. Every authenticated
   * response refreshes the token and so moves this forward, so the app treats
   * it as a deadline to re-pin, not as a countdown it owns.
   */
  expiresAt: z.number()
});
export type ConsolePinInResponse = z.infer<typeof consolePinInResponse>;

/**
 * Pin-out is the app DROPPING the token; there is no server-side session to
 * destroy. The call exists so the act is audited and so the app has one place
 * to confirm the operator header it just sent is gone.
 */
export const consolePinOutResponse = z.object({ ok: z.literal(true) });
export type ConsolePinOutResponse = z.infer<typeof consolePinOutResponse>;
