import { JsonLd, breadcrumbSchema } from "@/shared/seo/jsonld";

export function LegalPage({
  title,
  updated,
  path,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  /** Absolute path, so the breadcrumb points at the right URL. */
  path: string;
  intro?: string;
  sections: { heading: string; body: string }[];
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 md:py-16">
      {/* Breadcrumbs render in the SERP instead of the raw URL. Two lines, better
          result. */}
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: title, path },
        ])}
      />

      <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-2 font-mono-data text-[12px] text-muted-foreground">Last updated {updated}</p>

      {intro && (
        <p className="mt-8 text-[14.5px] leading-relaxed text-muted-foreground">{intro}</p>
      )}

      <div className="mt-8 flex flex-col gap-7">
        {sections.map((s) => (
          <section key={s.heading} className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold text-foreground">{s.heading}</h2>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
