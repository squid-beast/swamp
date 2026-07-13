import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in — SWAMP" };

export default function SignInPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="text-[13px] text-muted-foreground">Sign in to your swamp.</p>
      </div>
      <Suspense>
        <SignInForm />
      </Suspense>
      <p className="text-center text-[13px] text-muted-foreground">
        No account?{" "}
        <Link href="/register" className="font-medium text-foreground hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
