import {
  Avatar,
  Button,
  ClientOnly,
  cn,
  IconButton,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Separator,
  Toaster,
  TooltipProvider,
} from "@carbon/react";
import { Form, Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect, useState } from "react";

import {
  CarbonProvider,
  getCarbon,
  getCompanies,
  getUser,
  VERCEL_URL,
} from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";
import { LuLogOut } from "react-icons/lu";
import { defaultLayout } from "~/utils/layout";
import { path } from "~/utils/path";

export const ERP_URL = VERCEL_URL?.includes("localhost")
  ? "http://localhost:3000"
  : `https://app.carbonos.dev`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // share a client between requests
  const client = getCarbon(accessToken);

  // parallelize the requests
  const [companies, user] = await Promise.all([
    getCompanies(client, userId),
    getUser(client, userId),
  ]);

  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);
  if (!company) {
    throw redirect(ERP_URL);
  }

  return json({
    session: {
      accessToken,
      expiresIn,
      expiresAt,
    },
    company,
    companies: companies.data ?? [],
    user: user.data,
  });
}

export default function AuthenticatedRoute() {
  const { session, company, companies, user } = useLoaderData<typeof loader>();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const transition = useNavigation();

  /* NProgress */
  useEffect(() => {
    if (
      (transition.state === "loading" || transition.state === "submitting") &&
      !NProgress.isStarted()
    ) {
      NProgress.start();
    } else {
      NProgress.done();
    }
  }, [transition.state]);

  return (
    <CarbonProvider session={session}>
      <TooltipProvider delayDuration={0}>
        <ClientOnly fallback={null}>
          {() => (
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full items-stretch"
            >
              <ResizablePanel
                defaultSize={defaultLayout[0]}
                collapsedSize={4}
                collapsible={true}
                minSize={15}
                maxSize={20}
                onCollapse={() => {
                  setIsCollapsed(true);
                }}
                onExpand={() => {
                  setIsCollapsed(false);
                }}
                className={cn(
                  isCollapsed &&
                    "min-w-[50px] transition-all duration-300 ease-in-out"
                )}
              >
                <div
                  className={cn(
                    "flex h-[52px] items-center justify-start bg-background",
                    isCollapsed ? "h-[52px]" : "px-2"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center space-x-2 w-full",
                      isCollapsed ? "justify-center" : "justify-start"
                    )}
                  >
                    <Avatar
                      size="sm"
                      src={user?.avatarUrl ?? undefined}
                      name={user?.fullName ?? ""}
                    />
                    {!isCollapsed && (
                      <span className="text-sm truncate">{user?.fullName}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col h-[calc(100%-52px)] justify-between overflow-y-auto">
                  <div className="flex flex-col">
                    <Separator />
                  </div>
                  <div
                    className={cn(
                      "flex flex-col p-2 w-full",
                      isCollapsed && "items-center justify-center "
                    )}
                  >
                    <Modal>
                      <ModalTrigger asChild>
                        {isCollapsed ? (
                          <IconButton
                            type="submit"
                            aria-label="Sign out"
                            icon={<LuLogOut />}
                          />
                        ) : (
                          <Button size="lg" type="submit" className="w-full">
                            Sign out
                          </Button>
                        )}
                      </ModalTrigger>
                      <ModalContent size="small">
                        <ModalHeader>
                          <ModalTitle>Are you sure?</ModalTitle>
                          <ModalDescription>
                            You will be logged out
                          </ModalDescription>
                        </ModalHeader>

                        <ModalFooter>
                          <Form
                            method="post"
                            action={path.to.logout}
                            className="w-full"
                          >
                            <Button type="submit">Sign Out</Button>
                          </Form>
                        </ModalFooter>
                      </ModalContent>
                    </Modal>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <Outlet />
            </ResizablePanelGroup>
          )}
        </ClientOnly>
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </CarbonProvider>
  );
}
