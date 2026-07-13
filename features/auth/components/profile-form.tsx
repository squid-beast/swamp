"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/ui/form";
import { DateField } from "@/shared/components/date-field";
import { createClient } from "@/shared/supabase/client";

const schema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  dob: z.string().optional(),
  avatarUrl: z.string().url("Enter a valid URL").optional().or(z.literal("")),
});

type Initial = {
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  avatarUrl: string;
};

export function ProfileForm({ userId, initial }: { userId: string; initial: Initial }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      dob: initial.dob,
      avatarUrl: initial.avatarUrl,
    },
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);
    const supabase = createClient();
    // upsert (not update): users created before the profiles trigger existed have
    // no row yet, and .update() would match 0 rows and silently "succeed".
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      email: initial.email || null,
      first_name: values.firstName,
      last_name: values.lastName,
      dob: values.dob || null,
      avatar_url: values.avatarUrl || null,
      updated_at: new Date().toISOString(),
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Profile saved");
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-muted-foreground">Email</Label>
          <Input value={initial.email} readOnly disabled />
        </div>

        <FormField
          control={form.control}
          name="dob"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date of birth</FormLabel>
              <FormControl>
                <DateField
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select your date of birth"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="avatarUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Avatar URL</FormLabel>
              <FormControl>
                <Input placeholder="https://…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-fit" disabled={loading}>
          {loading ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </Form>
  );
}
