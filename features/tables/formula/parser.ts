import { FUNCTION_MAP } from "./functions";

// ════════════════════════════════════════════════════════════════════════════
// The formula parser.
//
// Text in, AST out. The AST is stored on the field and compiled to SQL by
// Postgres — the client never sends SQL, and never sends a string to be
// interpolated into one.
//
// ── Fields are stored by ID ──
//
// `{Amount} * 1.2` parses to a tree where the field node holds Amount's UUID, not
// the word "Amount". That is the entire reason a field has both a `name` and a
// `key`, and it buys one specific thing:
//
//     RENAMING A FIELD CAN NEVER BREAK A FORMULA.
//
// Rename "Amount" to "Contract value" and every formula keeps working, because no
// formula ever knew it was called "Amount". The display string is regenerated from
// the AST on demand; the AST is the truth.
//
// Store formulas by name and you have signed up to rewriting every formula in the
// base on every rename — and to getting it wrong when two fields share a name.
// ════════════════════════════════════════════════════════════════════════════

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "field"; id: string }
  | { t: "un"; op: "-" | "+" | "not"; a: Node }
  | { t: "bin"; op: BinOp; l: Node; r: Node }
  | { t: "call"; fn: string; args: Node[] };

export type BinOp =
  | "+" | "-" | "*" | "/"
  | "&"
  | "=" | "!=" | ">" | ">=" | "<" | "<="
  | "and" | "or";

export class FormulaError extends Error {
  constructor(message: string, readonly position?: number) {
    super(message);
    this.name = "FormulaError";
  }
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

type Token =
  | { k: "num"; v: number; p: number }
  | { k: "str"; v: string; p: number }
  | { k: "field"; v: string; p: number } // the name inside {braces}
  | { k: "ident"; v: string; p: number }
  | { k: "op"; v: string; p: number }
  | { k: "("; p: number }
  | { k: ")"; p: number }
  | { k: ","; p: number }
  | { k: "eof"; p: number };

const OPERATORS = [
  ">=", "<=", "!=", "<>", "==",
  "+", "-", "*", "/", "&", "=", ">", "<",
];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // {Field Name} — braces, because field names contain spaces and there is no
    // way to tell `Contract value` from two identifiers without them.
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) throw new FormulaError("Unclosed { — field names look like {Amount}", i);
      tokens.push({ k: "field", v: src.slice(i + 1, end).trim(), p: i });
      i = end + 1;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) {
          value += src[j + 1];
          j += 2;
          continue;
        }
        value += src[j];
        j++;
      }
      if (j >= src.length) throw new FormulaError("Unclosed string", i);
      tokens.push({ k: "str", v: value, p: i });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      const value = Number(text);
      if (Number.isNaN(value)) throw new FormulaError(`Not a number: ${text}`, i);
      tokens.push({ k: "num", v: value, p: i });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ k: "ident", v: src.slice(i, j), p: i });
      i = j;
      continue;
    }

    if (c === "(") { tokens.push({ k: "(", p: i }); i++; continue; }
    if (c === ")") { tokens.push({ k: ")", p: i }); i++; continue; }
    if (c === ",") { tokens.push({ k: ",", p: i }); i++; continue; }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ k: "op", v: op, p: i });
      i += op.length;
      continue;
    }

    throw new FormulaError(`Unexpected character: ${c}`, i);
  }

  tokens.push({ k: "eof", p: src.length });
  return tokens;
}

// ─── Precedence ─────────────────────────────────────────────────────────────
//
// Lower binds looser. This is the table that makes `1 + 2 * 3` equal 7 and not 9,
// and `a = 1 AND b = 2` parse as `(a = 1) AND (b = 2)` rather than `a = (1 AND b) = 2`.

const PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  "=": 3, "!=": 3, ">": 3, ">=": 3, "<": 3, "<=": 3,
  "&": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6,
};

const normalizeOp = (op: string): BinOp => {
  if (op === "==") return "=";
  if (op === "<>") return "!=";
  return op as BinOp;
};

export interface ParseContext {
  /** Field name → id. Case-insensitive: users don't remember capitalisation. */
  fieldsByName: Map<string, string>;
}

export function parseFormula(src: string, ctx: ParseContext): Node {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const expect = (kind: Token["k"]) => {
    const t = next();
    if (t.k !== kind) throw new FormulaError(`Expected ${kind}`, t.p);
    return t;
  };

  function parseExpr(minPrec = 0): Node {
    let left = parseUnary();

    for (;;) {
      const t = peek();

      let op: string | null = null;
      if (t.k === "op") op = t.v;
      else if (t.k === "ident" && ["and", "or"].includes(t.v.toLowerCase())) {
        op = t.v.toLowerCase();
      }

      if (!op) break;

      const prec = PRECEDENCE[normalizeOp(op)] ?? PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;

      next();
      // Left-associative: `10 - 3 - 2` is `(10 - 3) - 2` = 5, not 9.
      const right = parseExpr(prec + 1);

      left = { t: "bin", op: normalizeOp(op), l: left, r: right };
    }

    return left;
  }

  function parseUnary(): Node {
    const t = peek();

    if (t.k === "op" && (t.v === "-" || t.v === "+")) {
      next();
      return { t: "un", op: t.v as "-" | "+", a: parseUnary() };
    }
    if (t.k === "ident" && t.v.toLowerCase() === "not") {
      next();
      return { t: "un", op: "not", a: parseUnary() };
    }

    return parsePrimary();
  }

  function parsePrimary(): Node {
    const t = next();

    switch (t.k) {
      case "num":
        return { t: "num", v: t.v };
      case "str":
        return { t: "str", v: t.v };

      case "field": {
        const id = ctx.fieldsByName.get(t.v.toLowerCase());
        if (!id) throw new FormulaError(`There is no field called "${t.v}"`, t.p);
        // Stored by ID. A rename must never break this.
        return { t: "field", id };
      }

      case "(": {
        const inner = parseExpr(0);
        expect(")");
        return inner;
      }

      case "ident": {
        const upper = t.v.toUpperCase();

        if (upper === "TRUE") return { t: "bool", v: true };
        if (upper === "FALSE") return { t: "bool", v: false };

        const spec = FUNCTION_MAP.get(upper);
        if (!spec) throw new FormulaError(`Unknown function: ${t.v}`, t.p);

        expect("(");

        const args: Node[] = [];
        if (peek().k !== ")") {
          for (;;) {
            args.push(parseExpr(0));
            if (peek().k === ",") {
              next();
              continue;
            }
            break;
          }
        }
        expect(")");

        // Arity is checked here rather than in Postgres so the user gets the error
        // while they're typing, not after they've saved.
        if (args.length < spec.min || args.length > spec.max) {
          const range =
            spec.max === Infinity
              ? `at least ${spec.min}`
              : spec.min === spec.max
                ? `${spec.min}`
                : `${spec.min}–${spec.max}`;
          throw new FormulaError(
            `${upper} takes ${range} argument${spec.max === 1 ? "" : "s"}, got ${args.length}. ${spec.signature}`,
            t.p
          );
        }

        return { t: "call", fn: upper, args };
      }

      default:
        throw new FormulaError("Unexpected end of formula", t.p);
    }
  }

  const ast = parseExpr(0);

  const trailing = peek();
  if (trailing.k !== "eof") {
    throw new FormulaError("Unexpected trailing input", trailing.p);
  }

  return ast;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * Turn an AST back into text, using each field's CURRENT name.
 *
 * This is what makes renames invisible: the stored form is the AST, and the string
 * the user sees is regenerated from it every time. Rename a field and the formula
 * *displays* differently the next time you open it, without anything having been
 * rewritten.
 */
export function renderFormula(node: Node, fieldsById: Map<string, string>): string {
  switch (node.t) {
    case "num":
      return String(node.v);
    case "str":
      return `"${node.v.replace(/"/g, '\\"')}"`;
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "field":
      return `{${fieldsById.get(node.id) ?? "deleted field"}}`;
    case "un":
      return node.op === "not"
        ? `NOT ${renderFormula(node.a, fieldsById)}`
        : `${node.op}${renderFormula(node.a, fieldsById)}`;
    case "bin":
      return `(${renderFormula(node.l, fieldsById)} ${node.op} ${renderFormula(node.r, fieldsById)})`;
    case "call":
      return `${node.fn}(${node.args.map((a) => renderFormula(a, fieldsById)).join(", ")})`;
  }
}

/** Every field id a formula depends on. Used to detect cycles before saving. */
export function formulaDependencies(node: Node, out = new Set<string>()): Set<string> {
  switch (node.t) {
    case "field":
      out.add(node.id);
      break;
    case "un":
      formulaDependencies(node.a, out);
      break;
    case "bin":
      formulaDependencies(node.l, out);
      formulaDependencies(node.r, out);
      break;
    case "call":
      node.args.forEach((a) => formulaDependencies(a, out));
      break;
  }
  return out;
}
