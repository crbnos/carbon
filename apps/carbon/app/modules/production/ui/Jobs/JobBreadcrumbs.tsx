import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Button,
  Checkbox,
  HStack,
  Menubar,
  MenubarItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { Link, useFetcher, useLocation, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  LuAlertTriangle,
  LuDownload,
  LuHardHat,
  LuUpload,
} from "react-icons/lu";
import { BreadcrumbItem, Breadcrumbs } from "~/components";
import { Hidden, Item, Submit } from "~/components/Form";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { getJobMethodValidator } from "../../production.models";
import type { Job, JobMethod } from "../../types";

const JobBreadcrumbs = () => {
  const permissions = usePermissions();
  const { jobId, methodId, materialId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{ error: string | null }>();
  const routeData = useRouteData<{
    job: Job;
    method: Tree<JobMethod>;
  }>(path.to.job(jobId));

  const { pathname } = useLocation();

  const methodTree = routeData?.method;
  const hasMethods = methodTree?.children && methodTree.children.length > 0;

  const isGetMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.jobMethodGet;
  const isSaveMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.jobMethodSave;

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data?.error]);

  const [includeInactive, setIncludeInactive] = useState<
    boolean | "indeterminate"
  >(true);

  const getMethodModal = useDisclosure();
  const saveMethodModal = useDisclosure();

  const isJobMethod = pathname === path.to.jobMethod(jobId, methodId!);
  const isJobMakeMethod =
    methodId &&
    materialId &&
    pathname === path.to.jobMakeMethod(jobId, methodId, materialId);

  return isJobMethod || isJobMakeMethod ? (
    <>
      <Menubar>
        <HStack className="w-full justify-between">
          <Breadcrumbs>
            <BreadcrumbItem>
              <Button leftIcon={<LuHardHat />} variant="ghost" asChild>
                <Link to={path.to.jobDetails(jobId)}>
                  {routeData?.job?.jobId}
                </Link>
              </Button>
            </BreadcrumbItem>
          </Breadcrumbs>
          {permissions.can("update", "production") &&
            (isJobMethod || isJobMakeMethod) && (
              <HStack spacing={0}>
                <MenubarItem
                  isDisabled={
                    !permissions.can("update", "parts") || isSaveMethodLoading
                  }
                  isLoading={isSaveMethodLoading}
                  leftIcon={<LuUpload />}
                  onClick={saveMethodModal.onOpen}
                >
                  Save Method
                </MenubarItem>
                <MenubarItem
                  isLoading={isGetMethodLoading}
                  isDisabled={isGetMethodLoading}
                  leftIcon={<LuDownload />}
                  onClick={getMethodModal.onOpen}
                >
                  Get Method
                </MenubarItem>
              </HStack>
            )}
        </HStack>
      </Menubar>
      {getMethodModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              getMethodModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              fetcher={fetcher}
              action={path.to.jobMethodGet}
              validator={getJobMethodValidator}
              onSubmit={getMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Get Method</ModalTitle>
                <ModalDescription>
                  Overwrite the job method with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                {isJobMethod ? (
                  <>
                    <Hidden name="type" value="item" />
                    <Hidden name="targetId" value={jobId} />
                  </>
                ) : (
                  <>
                    <Hidden name="type" value="method" />
                    <Hidden name="targetId" value={materialId!} />
                  </>
                )}

                <VStack spacing={4}>
                  <Item
                    name="sourceId"
                    label="Source Method"
                    type={(routeData?.job.itemType ?? "Part") as "Part"}
                    includeInactive={includeInactive === true}
                    replenishmentSystem="Make"
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-inactive"
                      checked={includeInactive}
                      onCheckedChange={setIncludeInactive}
                    />
                    <label
                      htmlFor="include-inactive"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Include Inactive
                    </label>
                  </div>
                  {hasMethods && (
                    <Alert variant="destructive">
                      <LuAlertTriangle className="h-4 w-4" />
                      <AlertTitle>
                        This will overwrite the existing job method
                      </AlertTitle>
                    </Alert>
                  )}
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={getMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit variant={hasMethods ? "destructive" : "primary"}>
                  Confirm
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {saveMethodModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              saveMethodModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              fetcher={fetcher}
              action={path.to.jobMethodSave}
              validator={getJobMethodValidator}
              defaultValues={{
                targetId: isJobMethod
                  ? routeData?.job?.itemId ?? undefined
                  : undefined,
              }}
              onSubmit={saveMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Save Method</ModalTitle>
                <ModalDescription>
                  Overwrite the target manufacturing method with the job method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                {isJobMethod ? (
                  <>
                    <Hidden name="type" value="job" />
                    <Hidden name="sourceId" value={jobId} />
                  </>
                ) : (
                  <>
                    <Hidden name="type" value="method" />
                    <Hidden name="sourceId" value={materialId!} />
                  </>
                )}

                <VStack spacing={4}>
                  <Item
                    name="targetId"
                    label="Target Method"
                    type={(routeData?.job?.itemType ?? "Part") as "Part"}
                    includeInactive={includeInactive === true}
                    replenishmentSystem="Make"
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-inactive"
                      checked={includeInactive}
                      onCheckedChange={setIncludeInactive}
                    />
                    <label
                      htmlFor="include-inactive"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Include Inactive
                    </label>
                  </div>
                  {hasMethods && (
                    <Alert variant="destructive">
                      <LuAlertTriangle className="h-4 w-4" />
                      <AlertTitle>
                        This will overwrite the existing manufacturing method
                      </AlertTitle>
                    </Alert>
                  )}
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={saveMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit variant={hasMethods ? "destructive" : "primary"}>
                  Confirm
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </>
  ) : null;
};

export default JobBreadcrumbs;
