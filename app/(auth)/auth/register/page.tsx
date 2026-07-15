import Link from "next/link";
import { Suspense } from "react";
import { RegisterForm } from "@/features/auth/components/register-form";
import { pageMeta } from "@/shared/seo/metadata";

export const metadata = pageMeta({
  title: "Create your account",
  description: "Create a free SWAMP account with Google or an email and password.",
  path: "/auth/register",
  noindex: true,
});

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Create your account</h1>
        <p className="text-[13px] text-muted-foreground">
          Free while it&apos;s in beta. No card.
        </p>
      </div>
      <Suspense>
        <RegisterForm />
      </Suspense>
      <p className="text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
