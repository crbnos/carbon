"use client";

import { createHubspotCompany } from "@/app/submit";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormControl,
  Input,
  Label,
  Toaster,
  toast,
} from "@carbon/react";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormField, FormItem, FormMessage } from "./ui/Form";

const initialState = {
  success: null,
  message: null,
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" aria-disabled={pending}>
      Submit
    </Button>
  );
}

const formSchema = z.object({
  companyName: z.string(),
  companySize: z.string(),
  jobTitle: z.string(),
  erp: z.string(),
});

export default function CompanyForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      companyName: "",
      companySize: "",
      jobTitle: "",
      erp: "",
    },
  });
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const router = useRouter();

  const [state, formAction] = useFormState(createHubspotCompany, initialState);
  useEffect(() => {
    if (state.success === false) {
      toast.error(state.message);
    } else if (state.success === true) {
      toast.success("Thank you! We'll be in touch soon.");
      router.push("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <>
      <Form {...form}>
        <form action={formAction} className="w-full max-w-2xl">
          <input type="hidden" name="email" value={email} />
          <Card>
            <CardHeader>
              <CardTitle className="text-center ">
                Please tell us a little more about yourself
              </CardTitle>
              <CardDescription className="text-center">
                <Button variant="secondary" asChild>
                  <Link href="/">Skip</Link>
                </Button>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid space-y-8">
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Label>What is your company called?</Label>
                      <Input
                        type="string"
                        placeholder="Company name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="companySize"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Label>How big is your company?</Label>
                      <Input
                        type="string"
                        placeholder="E.g. 20-50"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="jobTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Label>What is your job title?</Label>
                      <Input type="string" placeholder="Job Title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="erp"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Label>Which ERP do you use currently?</Label>
                      <Input type="string" placeholder="Excel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <SubmitButton />
            </CardFooter>
          </Card>
        </form>
      </Form>
      <Toaster />
    </>
  );
}
