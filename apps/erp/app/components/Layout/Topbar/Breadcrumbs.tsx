import { ValidatedForm } from "@carbon/form";
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack,
  useDisclosure,
  useIsMobile,
} from "@carbon/react";
import { Form, Link, useMatches } from "@remix-run/react";
import { BsFillHexagonFill } from "react-icons/bs";
import { IoMdAdd } from "react-icons/io";
import { LuChevronsUpDown } from "react-icons/lu";
import { z } from "zod";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  Breadcrumbs as BreadcrumbsBase,
} from "~/components";

import { Currency, Input, Submit } from "~/components/Form";
import Country from "~/components/Form/Country";
import { useRouteData, useUser } from "~/hooks";
import { useMode } from "~/hooks/useMode";
import type { Company } from "~/modules/settings";
import { companyValidator } from "~/modules/settings/settings.models";
import { path } from "~/utils/path";

export const BreadcrumbHandle = z.object({
  breadcrumb: z.any(),
  to: z.string().optional(),
});
export type BreadcrumbHandleType = z.infer<typeof BreadcrumbHandle>;

const BreadcrumbHandleMatch = z.object({
  handle: BreadcrumbHandle,
});

const Breadcrumbs = () => {
  const matches = useMatches();

  const breadcrumbs = matches
    .map((m) => {
      const result = BreadcrumbHandleMatch.safeParse(m);
      if (!result.success || !result.data.handle.breadcrumb) return null;

      return {
        breadcrumb: result.data.handle.breadcrumb,
        to: result.data.handle?.to ?? m.pathname,
      };
    })
    .filter(Boolean);

  const isMobile = useIsMobile();
  const { company } = useUser();
  const mode = useMode();
  const logo = mode === "dark" ? company?.logoDarkIcon : company?.logoLightIcon;

  return (
    <HStack className="items-center h-full -ml-2" spacing={0}>
      <Button isIcon asChild variant="ghost" size="lg">
        <Link to="/">
          {logo ? (
            <img
              src={logo}
              alt={`${company.name} logo`}
              className="w-full h-auto rounded"
            />
          ) : (
            <BsFillHexagonFill />
          )}
        </Link>
      </Button>

      <BreadcrumbsBase className="line-clamp-1">
        {!isMobile && <CompanyBreadcrumb />}
        {breadcrumbs.map((breadcrumb, i) => (
          <BreadcrumbItem key={i}>
            <BreadcrumbLink
              isCurrentPage={!breadcrumb?.to}
              to={breadcrumb?.to ?? ""}
            >
              {breadcrumb?.breadcrumb}
            </BreadcrumbLink>
          </BreadcrumbItem>
        ))}
      </BreadcrumbsBase>
    </HStack>
  );
};

function CompanyBreadcrumb() {
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );
  const user = useUser();

  const hasMultipleCompanies = Boolean(
    routeData?.companies && routeData?.companies.length > 1
  );

  const canCreateCompany = user.admin === true;
  const hasCompanyMenu = canCreateCompany || hasMultipleCompanies;
  const companyForm = useDisclosure();

  const mode = useMode();

  return (
    <BreadcrumbItem isFirstChild>
      {hasCompanyMenu ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-current="page"
                variant="ghost"
                className="px-2 focus-visible:ring-transparent"
                rightIcon={<LuChevronsUpDown />}
              >
                {routeData?.company.name}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[240px]">
              <DropdownMenuLabel>Companies</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {routeData?.companies.map((c) => {
                  const logo =
                    mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                  return (
                    <Form
                      key={c.companyId}
                      method="post"
                      action={path.to.companySwitch(c.companyId!)}
                    >
                      <DropdownMenuItem
                        className="flex items-center justify-between w-full"
                        asChild
                      >
                        <button type="submit">
                          <HStack>
                            <Avatar
                              size="xs"
                              name={c.name ?? undefined}
                              src={logo ?? undefined}
                            />
                            <span>{c.name}</span>
                          </HStack>
                          <Badge variant="secondary" className="ml-2">
                            {c.employeeType}
                          </Badge>
                        </button>
                      </DropdownMenuItem>
                    </Form>
                  );
                })}
              </DropdownMenuGroup>

              {canCreateCompany && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={companyForm.onOpen}>
                      <DropdownMenuIcon icon={<IoMdAdd />} />
                      Add Company
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Modal
            open={companyForm.isOpen}
            onOpenChange={(open) => {
              if (!open) companyForm.onClose();
            }}
          >
            <ModalContent>
              <ValidatedForm
                action={path.to.newCompany}
                validator={companyValidator}
                method="post"
                onSubmit={companyForm.onClose}
              >
                <ModalHeader>
                  <ModalTitle>Let's set up your new company</ModalTitle>
                </ModalHeader>
                <ModalBody>
                  <VStack spacing={4}>
                    <Input autoFocus name="name" label="Company Name" />
                    <Input name="addressLine1" label="Address" />
                    <Input name="city" label="City" />
                    <Input name="stateProvince" label="State / Province" />
                    <Input name="postalCode" label="Postal Code" />
                    <Country name="countryCode" />
                    <Currency name="baseCurrencyCode" label="Base Currency" />
                  </VStack>
                </ModalBody>
                <ModalFooter>
                  <HStack>
                    <Submit>Save</Submit>
                  </HStack>
                </ModalFooter>
              </ValidatedForm>
            </ModalContent>
          </Modal>
        </>
      ) : (
        <BreadcrumbLink to="/">{routeData?.company.name}</BreadcrumbLink>
      )}
    </BreadcrumbItem>
  );
}

export default Breadcrumbs;
