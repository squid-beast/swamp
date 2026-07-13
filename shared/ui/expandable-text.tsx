"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";

interface ExpandableTextProps {
  text: string;
  label?: string;
  className?: string;
  previewClassName?: string;
  contentClassName?: string;
  maxPreviewWidth?: string;
  lines?: 1 | 2 | 3;
  children?: React.ReactNode;
  expanded?: React.ReactNode;
}

export function ExpandableText({
  text,
  label,
  className,
  previewClassName,
  contentClassName,
  maxPreviewWidth = "420px",
  lines = 2,
  children,
  expanded,
}: ExpandableTextProps) {
  const lineClampClass =
    lines === 1 ? "line-clamp-1" : lines === 3 ? "line-clamp-3" : "line-clamp-2";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "group/expand block w-full min-w-0 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            className
          )}
        >
          {children ?? (
            <span
              className={cn(
                "block whitespace-normal break-words transition-colors group-hover/expand:text-foreground group-hover/expand:underline group-hover/expand:decoration-dotted group-hover/expand:underline-offset-2",
                lineClampClass,
                previewClassName
              )}
              style={{ maxWidth: maxPreviewWidth }}
            >
              {text}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[min(36rem,calc(100vw-2rem))] max-h-[min(24rem,60vh)] overflow-auto p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {label && (
          <div className="border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        )}
        <div
          className={cn(
            "whitespace-pre-wrap break-words p-3 text-sm leading-relaxed",
            contentClassName
          )}
        >
          {expanded ?? text}
        </div>
      </PopoverContent>
    </Popover>
  );
}
