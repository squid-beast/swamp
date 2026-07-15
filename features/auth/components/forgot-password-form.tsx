"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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

const schema = z.object({ email: z.string().email("Enter a valid email") });

// Ask for a reset link.
//
// The response is the SAME whether or not the email has an account — "if that
// address has an account, we've sent a link." Telling the sender "no such user"
// turns this form into a way to check whether an email is registered, which is a
// small privacy leak people use at scale.

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);

    // The link goes through /auth/callback, which exchanges the `?code=` for a
    // session (the same PKCE path OAuth uses), THEN lands on the reset page — where
    // the user now has a session and can actually set a new password. Point it
    // straight at the reset page and there's a code sitting in the URL that nothing
    // exchanges, and the form has no session to act on.
    //
    // The error is never surfaced: whatever happens, the message is the same, so
    // this form can't be used to check whether an address has an account.
    await createClient().auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });

    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 text-[14px]">
        <p className="font-medium">Check your email</p>
        <p className="text-[13px] text-muted-foreground">
          If that address has an account, a reset link is on its way. It expires in an
          hour.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </Form>
  );
}
