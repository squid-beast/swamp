import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create account — SWAMP" };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Create your account</h1>
        <p className="text-[13px] text-muted-foreground">Start dumping data into the swamp.</p>
      </div>
      <Suspense>
        <RegisterForm />
      </Suspense>
      <p className="text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
