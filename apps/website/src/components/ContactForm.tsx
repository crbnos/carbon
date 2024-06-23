"use client";

import { createHubspotContact } from "@/app/submit";
import { Button, FormControl, Input, Toaster, toast } from "@carbon/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormField, FormItem, FormMessage } from "./ui/Form";

export default function ContactForm() {
  const router = useRouter();

  const formSchema = z.object({
    email: z.string().email(),
  });
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  });

  const handleSubmit = async (data: z.infer<typeof formSchema>) => {
    try {
      const formData = new FormData();
      formData.append("email", data.email);
      const { success } = await createHubspotContact(formData);
      if (success) {
        const email = encodeURIComponent(data.email);
        router.push(`/form?email=${email}`);
      } else {
        toast.error(
          "Failed to create contact. It's possible that you've already subscribed."
        );
      }
    } catch (error) {
      toast.error("Failed to submit form. Please try again.");
    }
  };

  return (
    <>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex sm:flex-row flex-col gap-2 sm:items-start items-center"
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    className="border-border w-full sm:w-fit"
                    size="lg"
                    type="email"
                    placeholder="Company email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button size="lg" className="w-full sm:w-fit" type="submit">
            Subscribe
          </Button>
        </form>
      </Form>
      <Toaster />
    </>
  );
}
