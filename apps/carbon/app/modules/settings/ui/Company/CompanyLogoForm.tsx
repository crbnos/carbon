import { Avatar, Button, File, VStack, toast } from "@carbon/react";
import { useSubmit } from "@remix-run/react";
import { type ChangeEvent } from "react";
import { useSupabase } from "~/lib/supabase";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";

type CompanyLogoFormProps = {
  company: Company;
};

const CompanyLogoForm = ({ company }: CompanyLogoFormProps) => {
  const { supabase } = useSupabase();
  const submit = useSubmit();

  const logoPath = company?.logo
    ? company.logo.substring(company.logo.lastIndexOf("/") + 1)
    : null;

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && supabase) {
      const logo = e.target.files[0];
      const fileExtension = logo.name.substring(logo.name.lastIndexOf(".") + 1);

      const imageUpload = await supabase.storage
        .from("public")
        .upload(`${company.id}/logo.${fileExtension}`, logo, {
          cacheControl: "0",
          upsert: true,
        });

      if (imageUpload.error) {
        toast.error("Failed to upload logo");
      }

      if (imageUpload.data?.path) {
        submitLogoUrl(imageUpload.data.path);
      }
    }
  };

  const deleteImage = async () => {
    if (supabase && logoPath) {
      const imageDelete = await supabase.storage
        .from("public")
        .remove([logoPath]);

      if (imageDelete.error) {
        toast.error("Failed to remove image");
      }

      submitLogoUrl(null);
    }
  };

  const submitLogoUrl = (logoUrl: string | null) => {
    const formData = new FormData();
    formData.append("intent", "logo");
    if (logoUrl) formData.append("path", logoUrl);
    submit(formData, {
      method: "post",
      action: path.to.company,
    });
  };

  return (
    <VStack className="items-center p-4">
      {company?.logo ? (
        <img
          alt={`${company.name} Logo`}
          width="128"
          height="auto"
          src={company.logo}
          className="rounded-lg"
        />
      ) : (
        <Avatar name={company?.name ?? undefined} size="2xl" />
      )}

      <File accept="image/*" onChange={uploadImage}>
        {company.logo ? "Change" : "Upload"}
      </File>

      {company.logo && (
        <Button variant="secondary" onClick={deleteImage}>
          Remove
        </Button>
      )}
    </VStack>
  );
};

export default CompanyLogoForm;
