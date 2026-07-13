export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro?: string;
  sections: { heading: string; body: string }[];
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 md:py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-2 font-mono-data text-[12px] text-muted-foreground">Last updated {updated}</p>

      <div className="mt-4 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">
        Placeholder template. Replace with your reviewed legal copy before launch.
      </div>

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
