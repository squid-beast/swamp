"use client";

import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";

// String (yyyy-MM-dd) in / out, so it drops straight into the existing form
// schemas. Uses the shadcn Calendar with month + year dropdowns. Forwards
// id / aria / ref onto the trigger button so it associates with a FormLabel
// when wrapped in <FormControl>.
export const DateField = React.forwardRef<
  HTMLButtonElement,
  {
    value?: string;
    onChange: (value: string) => void;
    placeholder?: string;
    fromYear?: number;
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }
>(function DateField(
  { value, onChange, placeholder = "Pick a date", fromYear = 1920, ...triggerProps },
  ref
) {
  const [open, setOpen] = React.useState(false);
  const parsed = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const date = parsed && isValid(parsed) ? parsed : undefined;
  const now = new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !date && "text-muted-foreground"
          )}
          {...triggerProps}
        >
          <CalendarDays className="size-4 shrink-0 opacity-70" />
          {date ? format(date, "PPP") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          captionLayout="dropdown"
          startMonth={new Date(fromYear, 0)}
          endMonth={new Date(now.getFullYear(), 11)}
          defaultMonth={date ?? new Date(2000, 0)}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
});
