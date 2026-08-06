// The function library. One source of truth, shared by the parser (which checks
// arity), the editor's autocomplete, and the docs.
//
// The Postgres compiler has its own copy of this list — it must, because it is the
// security boundary and cannot trust anything the client sends. These two lists
// agreeing is a correctness property, not a convenience: a function here that
// isn't there produces a formula that parses and then fails to compile.

export interface FnSpec {
  name: string;
  min: number;
  max: number; // Infinity for variadic
  signature: string;
  description: string;
  returns: "number" | "text" | "boolean" | "date";
}

export const FUNCTIONS: FnSpec[] = [
  // Logic
  { name: "IF", min: 2, max: 3, signature: "IF(condition, then, else)", description: "Branch on a condition.", returns: "text" },
  { name: "AND", min: 1, max: Infinity, signature: "AND(a, b, …)", description: "True when every argument is true.", returns: "boolean" },
  { name: "OR", min: 1, max: Infinity, signature: "OR(a, b, …)", description: "True when any argument is true.", returns: "boolean" },
  { name: "NOT", min: 1, max: 1, signature: "NOT(a)", description: "Invert.", returns: "boolean" },
  { name: "BLANK", min: 0, max: 0, signature: "BLANK()", description: "An empty value.", returns: "text" },
  { name: "ISBLANK", min: 1, max: 1, signature: "ISBLANK(value)", description: "True when the value is empty.", returns: "boolean" },
  { name: "ISNOTBLANK", min: 1, max: 1, signature: "ISNOTBLANK(value)", description: "True when the value is not empty.", returns: "boolean" },

  // Text
  { name: "CONCAT", min: 1, max: Infinity, signature: "CONCAT(a, b, …)", description: "Join values into text.", returns: "text" },
  { name: "UPPER", min: 1, max: 1, signature: "UPPER(text)", description: "Uppercase.", returns: "text" },
  { name: "LOWER", min: 1, max: 1, signature: "LOWER(text)", description: "Lowercase.", returns: "text" },
  { name: "TRIM", min: 1, max: 1, signature: "TRIM(text)", description: "Strip leading and trailing spaces.", returns: "text" },
  { name: "LEN", min: 1, max: 1, signature: "LEN(text)", description: "Character count.", returns: "number" },
  { name: "LEFT", min: 2, max: 2, signature: "LEFT(text, n)", description: "First n characters.", returns: "text" },
  { name: "RIGHT", min: 2, max: 2, signature: "RIGHT(text, n)", description: "Last n characters.", returns: "text" },
  { name: "MID", min: 3, max: 3, signature: "MID(text, start, count)", description: "A slice, 1-indexed.", returns: "text" },
  { name: "REPLACE", min: 3, max: 3, signature: "REPLACE(text, find, replace)", description: "Replace every occurrence.", returns: "text" },
  { name: "SEARCH", min: 2, max: 2, signature: "SEARCH(text, find)", description: "Position of find in text, or blank.", returns: "number" },

  // Numbers
  { name: "ABS", min: 1, max: 1, signature: "ABS(n)", description: "Absolute value.", returns: "number" },
  { name: "ROUND", min: 1, max: 2, signature: "ROUND(n, places)", description: "Round to n places.", returns: "number" },
  { name: "CEILING", min: 1, max: 1, signature: "CEILING(n)", description: "Round up.", returns: "number" },
  { name: "FLOOR", min: 1, max: 1, signature: "FLOOR(n)", description: "Round down.", returns: "number" },
  { name: "SQRT", min: 1, max: 1, signature: "SQRT(n)", description: "Square root.", returns: "number" },
  { name: "POWER", min: 2, max: 2, signature: "POWER(n, exponent)", description: "n to the power of exponent.", returns: "number" },
  { name: "MOD", min: 2, max: 2, signature: "MOD(n, divisor)", description: "Remainder.", returns: "number" },
  { name: "MIN", min: 1, max: Infinity, signature: "MIN(a, b, …)", description: "Smallest.", returns: "number" },
  { name: "MAX", min: 1, max: Infinity, signature: "MAX(a, b, …)", description: "Largest.", returns: "number" },

  // Dates
  { name: "NOW", min: 0, max: 0, signature: "NOW()", description: "The current moment. Re-evaluated on every read.", returns: "date" },
  { name: "TODAY", min: 0, max: 0, signature: "TODAY()", description: "Midnight today.", returns: "date" },
  { name: "YEAR", min: 1, max: 1, signature: "YEAR(date)", description: "The year.", returns: "number" },
  { name: "MONTH", min: 1, max: 1, signature: "MONTH(date)", description: "The month, 1–12.", returns: "number" },
  { name: "DAY", min: 1, max: 1, signature: "DAY(date)", description: "The day of the month.", returns: "number" },
  { name: "WEEKDAY", min: 1, max: 1, signature: "WEEKDAY(date)", description: "Day of week, 0 = Sunday.", returns: "number" },
  { name: "DATEADD", min: 2, max: 2, signature: "DATEADD(date, days)", description: "Shift a date by n days.", returns: "date" },
  { name: "DATEDIFF", min: 2, max: 2, signature: "DATEDIFF(later, earlier)", description: "Days between two dates.", returns: "number" },
  { name: "DATEFORMAT", min: 2, max: 2, signature: "DATEFORMAT(date, format)", description: "Format a date, e.g. 'YYYY-MM-DD'.", returns: "text" },

  // Record
  { name: "RECORD_ID", min: 0, max: 0, signature: "RECORD_ID()", description: "This record's id.", returns: "text" },

  // ── NocoDB-parity additions. Every name below has a mirroring arm in
  // swamp_formula_fn — add nowhere without adding in both places. ──

  // Logic
  { name: "SWITCH", min: 3, max: Infinity, signature: "SWITCH(value, pattern, result, …, [default])", description: "Match value against patterns; first hit wins.", returns: "text" },
  { name: "XOR", min: 1, max: Infinity, signature: "XOR(a, b, …)", description: "True when an odd number of arguments are true.", returns: "boolean" },

  // Text
  { name: "REPEAT", min: 2, max: 2, signature: "REPEAT(text, n)", description: "Repeat text n times.", returns: "text" },
  { name: "URLENCODE", min: 1, max: 1, signature: "URLENCODE(text)", description: "Percent-encode for use in a URL.", returns: "text" },
  { name: "REGEX_MATCH", min: 2, max: 2, signature: "REGEX_MATCH(text, pattern)", description: "True when the pattern matches.", returns: "boolean" },
  { name: "REGEX_EXTRACT", min: 2, max: 2, signature: "REGEX_EXTRACT(text, pattern)", description: "The first match of the pattern, or blank.", returns: "text" },
  { name: "REGEX_REPLACE", min: 3, max: 3, signature: "REGEX_REPLACE(text, pattern, replacement)", description: "Replace every match of the pattern.", returns: "text" },
  { name: "MD5", min: 1, max: 1, signature: "MD5(text)", description: "MD5 hash, as hex.", returns: "text" },

  // Numbers
  { name: "EVEN", min: 1, max: 1, signature: "EVEN(n)", description: "Round away from zero to the nearest even integer.", returns: "number" },
  { name: "ODD", min: 1, max: 1, signature: "ODD(n)", description: "Round away from zero to the nearest odd integer.", returns: "number" },
  { name: "ROUNDDOWN", min: 1, max: 2, signature: "ROUNDDOWN(n, places)", description: "Round toward zero.", returns: "number" },
  { name: "ROUNDUP", min: 1, max: 2, signature: "ROUNDUP(n, places)", description: "Round away from zero.", returns: "number" },
  { name: "INT", min: 1, max: 1, signature: "INT(n)", description: "Round down to an integer.", returns: "number" },
  { name: "VALUE", min: 1, max: 1, signature: "VALUE(text)", description: "The number in a text value, or blank.", returns: "number" },
  { name: "LOG", min: 1, max: 2, signature: "LOG(n, [base])", description: "Logarithm, base 10 unless given.", returns: "number" },
  { name: "EXP", min: 1, max: 1, signature: "EXP(n)", description: "e to the power of n.", returns: "number" },

  // Arrays — for lookup and multi-select values
  { name: "ARRAYUNIQUE", min: 1, max: 1, signature: "ARRAYUNIQUE(array)", description: "Distinct items.", returns: "text" },
  { name: "ARRAYSORT", min: 1, max: 1, signature: "ARRAYSORT(array)", description: "Items, sorted.", returns: "text" },
  { name: "ARRAYCOMPACT", min: 1, max: 1, signature: "ARRAYCOMPACT(array)", description: "Items with blanks removed.", returns: "text" },
  { name: "ARRAYSLICE", min: 3, max: 3, signature: "ARRAYSLICE(array, start, end)", description: "Items from start to end, 1-indexed.", returns: "text" },
  { name: "COUNTA", min: 1, max: Infinity, signature: "COUNTA(a, b, …)", description: "How many values are not empty. Counts items of an array value.", returns: "number" },
  { name: "COUNT", min: 1, max: Infinity, signature: "COUNT(a, b, …)", description: "How many values are numbers.", returns: "number" },
  { name: "COUNTALL", min: 1, max: Infinity, signature: "COUNTALL(a, b, …)", description: "How many values, empty or not.", returns: "number" },

  // Dates
  { name: "DATETIME_DIFF", min: 2, max: 3, signature: "DATETIME_DIFF(later, earlier, [unit])", description: "Difference in the unit: seconds, minutes, hours, days, weeks, months, years. Days unless given.", returns: "number" },
  { name: "HOUR", min: 1, max: 1, signature: "HOUR(date)", description: "The hour, 0–23.", returns: "number" },
  { name: "MINUTE", min: 1, max: 1, signature: "MINUTE(date)", description: "The minute, 0–59.", returns: "number" },
  { name: "SECOND", min: 1, max: 1, signature: "SECOND(date)", description: "The second, 0–59.", returns: "number" },
];

export const FUNCTION_MAP = new Map(FUNCTIONS.map((f) => [f.name, f]));
