import { Input, Number, Select, ValidatedForm, validator } from "@carbon/form";
import { Button, Heading, toast, TooltipProvider } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { useEffect } from "react";
import z from "zod";
import { zfd } from "zod-form-data";
import { CONFIGURED_ITEM_ID } from "~/config";
import { carbon } from "~/lib/carbon.server";

const formValidator = z.object({
  email: z.string().email(),
  material: z.string().min(1),
  height: zfd.numeric(z.number().min(0)),
  width: zfd.numeric(z.number().min(0)),
  length: zfd.numeric(z.number().min(0)),
});

export async function action({ request }: ActionFunctionArgs) {
  const validation = await validator(formValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(
      {
        success: false,
        message: "Invalid form data",
        data: null,
      },
      { status: 500 }
    );
  }

  const { email, material, height, width, length } = validation.data;

  // Get customer by email (you'll need to add email to the form)
  const [customer, sequence] = await Promise.all([
    carbon.getCustomerByEmail(email),
    carbon.getNextSequence("quote"),
  ]); // Replace with actual email from form

  if (customer.error) {
    return json(
      {
        success: false,
        message: "Failed to get customer from email",
        data: null,
      },
      { status: 500 }
    );
  }

  if (sequence.error) {
    return json(
      {
        success: false,
        message: "Failed to get next sequence",
        data: null,
      },
      { status: 500 }
    );
  }

  const quoteId = sequence.data;

  const quoteInsert = await carbon.upsertQuote({
    quoteId,
    customerId: customer.data.id,
    currencyCode: "USD",
    createdBy: "system",
  });

  if (quoteInsert.error || !quoteInsert.data) {
    console.error(quoteInsert.error);
    return json(
      {
        success: false,
        message: "Failed to create quote",
        data: null,
      },
      { status: 500 }
    );
  }

  const configuration = {
    width,
    height,
    length,
    material,
  };

  const quoteLineInsert = await carbon.upsertQuoteLine({
    quoteId: quoteInsert.data.id,
    itemId: CONFIGURED_ITEM_ID,
    description: `${material} Custom Item - ${width}x${height}x${length}`,
    methodType: "Make",
    unitOfMeasureCode: "EA",
    quantity: [1, 25, 50, 100],
    configuration,
  });

  if (quoteLineInsert.error || !quoteLineInsert.data) {
    console.error(quoteLineInsert.error);
    return json(
      {
        success: false,
        message: "Failed to create quote line",
        data: null,
      },
      { status: 500 }
    );
  }

  const upsertMethod = await carbon.upsertQuoteLineMethod({
    quoteId: quoteInsert.data.id,
    quoteLineId: quoteLineInsert.data.id,
    itemId: CONFIGURED_ITEM_ID,
    configuration,
  });

  if (upsertMethod.error) {
    console.error(upsertMethod.error);
    return json(
      {
        success: false,
        message: "Failed to create quote line method",
        data: null,
      },
      { status: 500 }
    );
  }

  return json({
    success: true,
    message: `Quote created: ${quoteInsert.data.quoteId}`,
    data: {
      quoteId: quoteInsert.data.quoteId,
      id: quoteInsert.data.id,
    },
  });
}

export default function Route() {
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success === true) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col items-center justify-center p-4">
        <div className="max-w-xl text-center flex flex-col gap-8">
          <Heading size="h1">Quote Configurator</Heading>

          <ValidatedForm
            method="post"
            fetcher={fetcher}
            validator={formValidator}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-4">
              <Input
                name="email"
                label="Email"
                type="email"
                placeholder="Enter your email"
              />
              <Select
                name="material"
                label="Material"
                options={["Steel", "Aluminum", "Copper"].map((material) => ({
                  label: material,
                  value: material,
                }))}
              />
              <Number name="height" label="Height" />
              <Number name="width" label="Width" />
              <Number name="length" label="Length" />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Generate Quote
            </Button>
          </ValidatedForm>
        </div>
      </div>
    </TooltipProvider>
  );
}
