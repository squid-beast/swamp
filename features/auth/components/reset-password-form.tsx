"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/ui/form";
import { createClient } from "@/shared/supabase/client";

const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "The two passwords don't match",
    path: ["confirm"],
  });

// Set a new password.
//
// You arrive here from the emailed link. Supabase's client library reads the token
// out of the URL fragment and opens a temporary recovery session on load — so by
// the time this form submits, `updateUser` has a session to act on. If it doesn't,
// the link was old or already used, and we say so rather than failing silently on
// submit.

export function ResetPasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  useEffect(() => {
    const supabase = createClient();
    // The recovery session lands asynchronously as the library parses the URL.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else setTimeout(() => setReady((r) => r ?? false), 1500);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password: values.password });
    setLoading(false);

    if (error) return toast.error(error.message);

    toast.success("Password updated. You're signed in.");
    router.push("/app");
    router.refresh();
  }

  if (ready === false) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 text-[14px]">
        <p className="font-medium">This link has expired</p>
        <p className="text-[13px] text-muted-foreground">
          Reset links are single-use and last an hour. Ask for a fresh one and try again.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={loading || ready === null}>
          {loading ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </Form>
  );
}
