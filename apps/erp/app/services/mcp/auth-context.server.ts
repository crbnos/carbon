// Back-compat re-export. The canonical home is
// `@carbon/auth/auth-context.server` (it must live in the package because
// `requirePermissions` — shared by ERP, MES and academy — reads it; a package
// cannot import from an app). Existing imports via `~/services/mcp` continue
// to work unchanged.

export type { AuthContext } from "@carbon/auth/auth-context.server";
export {
  AuthClientScope,
  AuthContextHolder,
  getAuthClient,
  runWithSystemClient,
  runWithSystemContext
} from "@carbon/auth/auth-context.server";
