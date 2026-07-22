"use client";

import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Calendar } from "@/shared/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";

// String (yyyy-MM-dd) in / out, so it drops straight into the existing form
// schemas.
//
// Month and year are picked with shadcn Selects, not react-day-picker's built-in
// `captionLayout="dropdown"`. That default renders NATIVE <select>s — and a
// hundred-year list opens as a browser popup that runs the full height of the
// page and can't be themed. The Radix Select popovers here are compact,
// scrollable and match the rest of the app. The Selects drive the calendar's
// visible month; the calendar's own caption and nav are hidden.
//
// Forwards id / aria / ref onto the trigger button so it associates with a
// FormLabel when wrapped in <FormControl>.

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString("default", { month: "long" })
);

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
  const today = React.useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();

  // The month the grid is showing. Selects move it; picking a day reads it.
  const [month, setMonth] = React.useState<Date>(date ?? new Date(2000, 0));

  // Reopening should land on the selected date (or a sensible default), never on
  // whatever month was last scrolled to.
  React.useEffect(() => {
    if (open) setMonth(date ?? new Date(2000, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Newest year first — the common case for a date of birth is closer to today.
  const years = React.useMemo(() => {
    const list: number[] = [];
    for (let y = currentYear; y >= fromYear; y--) list.push(y);
    return list;
  }, [currentYear, fromYear]);

  const setPart = (part: "month" | "year", n: number) =>
    setMonth((m) =>
      new Date(
        part === "year" ? n : m.getFullYear(),
        part === "month" ? n : m.getMonth(),
        1
      )
    );

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
      <PopoverContent className="w-auto p-3" align="start">
        <div className="mb-3 flex items-center gap-2">
          <Select
            value={String(month.getMonth())}
            onValueChange={(v) => setPart("month", Number(v))}
          >
            <SelectTrigger className="h-8 flex-1" aria-label="Month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((label, i) => (
                <SelectItem key={label} value={String(i)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(month.getFullYear())}
            onValueChange={(v) => setPart("year", Number(v))}
          >
            <SelectTrigger className="h-8 w-[5.25rem]" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={date}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          captionLayout="label"
          startMonth={new Date(fromYear, 0)}
          endMonth={new Date(currentYear, 11)}
          disabled={{ after: today }}
          className="p-0"
          classNames={{ month_caption: "hidden", nav: "hidden" }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
});
