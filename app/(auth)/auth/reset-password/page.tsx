import { Suspense } from "react";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { pageMeta } from "@/shared/seo/metadata";

export const metadata = pageMeta({
  title: "Set a new password",
  description: "Choose a new password for your SWAMP account.",
  path: "/auth/reset-password",
  noindex: true,
});

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          Choose a new password
        </h1>
        <p className="text-[13px] text-muted-foreground">
          You&apos;ll be signed in once it&apos;s saved.
        </p>
      </div>

      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
