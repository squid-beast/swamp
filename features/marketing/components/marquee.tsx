import { cn } from "@/shared/lib/utils";

// A marquee band of the things people build in SWAMP.
//
// It answers "what is this actually for?" without a wall of text. The content is
// DUPLICATED once and the track scrolls to exactly -50%, so the second copy lands
// where the first began — a seamless loop with no jump. Pointer over the strip
// pauses it, so anyone reading a specific item can.
//
// It's decorative (aria-hidden); the same use-cases live in the visible copy
// around it, so nothing here is the only place a screen reader could find them.

export function Marquee({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  const loop = [...items, ...items];

  return (
    <div
      className={cn(
        "group relative flex overflow-hidden",
        // Fade the two edges so words appear/vanish instead of hard-cutting.
        "[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
        className
      )}
      aria-hidden="true"
    >
      <div className="flex shrink-0 animate-marquee items-center gap-3 pr-3 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {loop.map((item, i) => (
          <span key={i} className="flex items-center gap-3">
            <span className="whitespace-nowrap text-[15px] font-medium text-foreground/70">
              {item}
            </span>
            <span className="size-1 rounded-full bg-primary/50" />
          </span>
        ))}
      </div>
    </div>
  );
}
