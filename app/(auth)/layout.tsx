import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
        SWAMP
      </Link>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-7">
        {children}
      </div>
    </div>
  );
}
