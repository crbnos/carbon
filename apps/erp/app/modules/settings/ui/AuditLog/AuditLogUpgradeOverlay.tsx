import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Switch,
  VStack
} from "@carbon/react";
import { LuHistory } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

/**
 * A blurred mock preview of the audit log settings page with an upgrade CTA overlay.
 * Shown to Starter plan users who don't have access to audit logs.
 */
export default function AuditLogUpgradeOverlay() {
  return (
    <div className="relative w-full">
      {/* Blurred mock content */}
      <div
        className="blur-[2px] pointer-events-none select-none"
        aria-hidden="true"
      >
        <Card>
          <CardHeader>
            <CardTitle>Audit Logging</CardTitle>
            <CardDescription>
              Track changes to key business entities including invoices, orders,
              customers, suppliers, and more.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start gap-1">
                <span className="font-medium">Audit logging is disabled</span>
                <span className="text-sm text-muted-foreground">
                  Enable to start tracking changes to your data.
                </span>
              </VStack>
              <Switch checked={false} disabled />
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Archived Logs</CardTitle>
            <CardDescription>
              Logs older than 30 days are automatically archived.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VStack className="gap-2">
              {[1, 2].map((i) => (
                <HStack
                  key={i}
                  className="justify-between items-center p-6 border rounded-md w-full"
                >
                  <VStack className="items-start">
                    <span className="font-medium text-sm">
                      Jan 1, 2026 - Jan 31, 2026
                    </span>
                    <span className="text-xs text-muted-foreground">
                      1,234 records (2.1 MB)
                    </span>
                  </VStack>
                  <div className="h-8 w-24 rounded bg-muted" />
                </HStack>
              ))}
            </VStack>
          </CardContent>
        </Card>
      </div>

      {/* Upgrade overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Card className="max-w-md shadow-lg">
          <CardContent className="flex flex-col items-center text-center gap-4 pt-6">
            <div className="rounded-full bg-muted p-3">
              <LuHistory className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Audit Logs</h3>
              <p className="text-sm text-muted-foreground text-balance">
                Track every change to your orders, invoices, customers,
                suppliers, and more.
              </p>
            </div>
            <Button asChild>
              <Link to={path.to.billing}>Upgrade to Business</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
