import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { pageMeta } from "@/shared/seo/metadata";

// A login screen is not a landing page. Indexed, it puts a hundred URL variants of
// itself in Google under a hundred `?next=` params, and none of them rank for
// anything. noindex.
export const metadata = pageMeta({
  title: "Sign in",
  description: "Sign in to your SWAMP workspace.",
  path: "/auth/sign-in",
  noindex: true,
});

export default function SignInPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams?.error;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="text-[13px] text-muted-foreground">Sign in to your swamp.</p>
      </div>

      {/* Surfaced from the OAuth callback (?error=…) so a failed sign-in explains
          itself instead of silently returning you here. */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Suspense>
        <SignInForm />
      </Suspense>
      <p className="text-center text-[13px] text-muted-foreground">
        No account?{" "}
        <Link href="/auth/register" className="font-medium text-foreground hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
