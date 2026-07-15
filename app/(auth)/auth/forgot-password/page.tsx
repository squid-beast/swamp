import Link from "next/link";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { pageMeta } from "@/shared/seo/metadata";

// noindex: a password-reset page has no reason to be in a search index, and a
// crawler that lands here just wastes budget on a form it can't use.
export const metadata = pageMeta({
  title: "Reset your password",
  description: "Get a link to reset your SWAMP password.",
  path: "/auth/forgot-password",
  noindex: true,
});

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Enter your email and we&apos;ll send you a link.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-center text-[13px] text-muted-foreground">
        Remembered it?{" "}
        <Link href="/auth/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
