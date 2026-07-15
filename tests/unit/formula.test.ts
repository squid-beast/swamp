import { describe, expect, it } from "vitest";
import {
  FormulaError,
  formulaDependencies,
  parseFormula,
  renderFormula,
  type Node,
} from "@/features/tables/formula/parser";

// ════════════════════════════════════════════════════════════════════════════
// The formula parser.
//
// The single most important property it has is that FIELD REFERENCES ARE IDs.
// `{Amount} * 1.2` parses to a tree holding Amount's UUID, not the word "Amount".
// That is what makes renaming a field free, and it is the first test below.
// ════════════════════════════════════════════════════════════════════════════

const AMOUNT = "11111111-1111-1111-1111-111111111111";
const QTY = "22222222-2222-2222-2222-222222222222";

const ctx = {
  fieldsByName: new Map([
    ["amount", AMOUNT],
    ["quantity", QTY],
  ]),
};

const byId = new Map([
  [AMOUNT, "Amount"],
  [QTY, "Quantity"],
]);

const parse = (src: string) => parseFormula(src, ctx);

describe("field references", () => {
  it("stores a field by ID, never by name", () => {
    // The whole ballgame. If this stored "Amount", then renaming the column would
    // require rewriting every formula in the base — and getting it wrong the
    // moment two fields shared a name.
    expect(parse("{Amount}")).toEqual({ t: "field", id: AMOUNT });
  });

  it("is case-insensitive about field names", () => {
    // Nobody remembers whether the column is "Amount" or "amount".
    expect(parse("{AMOUNT}")).toEqual({ t: "field", id: AMOUNT });
  });

  it("names a field that doesn't exist, rather than saying 'invalid'", () => {
    expect(() => parse("{Amont}")).toThrow(/no field called "Amont"/);
  });

  it("survives a rename — the AST is unchanged, only the rendering moves", () => {
    const ast = parse("{Amount} * 2");

    // The user renames "Amount" to "Contract value". Nothing rewrites the AST.
    const renamed = new Map([[AMOUNT, "Contract value"], [QTY, "Quantity"]]);

    expect(renderFormula(ast, renamed)).toBe("({Contract value} * 2)");
    // ...and the tree still points at the same field.
    expect(formulaDependencies(ast)).toEqual(new Set([AMOUNT]));
  });
});

describe("precedence", () => {
  it("multiplies before adding", () => {
    // 1 + 2 * 3 is 7, not 9. This is the table that makes it so.
    const ast = parse("1 + 2 * 3") as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe("+");
    expect((ast.r as Extract<Node, { t: "bin" }>).op).toBe("*");
  });

  it("respects parentheses", () => {
    const ast = parse("(1 + 2) * 3") as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe("*");
    expect((ast.l as Extract<Node, { t: "bin" }>).op).toBe("+");
  });

  it("is left-associative for subtraction", () => {
    // 10 - 3 - 2 is (10 - 3) - 2 = 5, not 10 - (3 - 2) = 9.
    const ast = parse("10 - 3 - 2") as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe("-");
    expect((ast.l as Extract<Node, { t: "bin" }>).op).toBe("-");
    expect(ast.r).toEqual({ t: "num", v: 2 });
  });

  it("binds comparison looser than arithmetic", () => {
    // {Amount} + 1 > 10 must parse as ({Amount} + 1) > 10, not {Amount} + (1 > 10).
    const ast = parse("{Amount} + 1 > 10") as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe(">");
    expect((ast.l as Extract<Node, { t: "bin" }>).op).toBe("+");
  });

  it("binds AND looser than comparison", () => {
    // a = 1 AND b = 2 is (a = 1) AND (b = 2).
    const ast = parse("{Amount} = 1 AND {Quantity} = 2") as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe("and");
    expect((ast.l as Extract<Node, { t: "bin" }>).op).toBe("=");
    expect((ast.r as Extract<Node, { t: "bin" }>).op).toBe("=");
  });

  it("binds OR looser than AND", () => {
    const ast = parse("TRUE OR TRUE AND FALSE") as Extract<Node, { t: "bin" }>;
    expect(ast.op).toBe("or");
    expect((ast.r as Extract<Node, { t: "bin" }>).op).toBe("and");
  });
});

describe("functions", () => {
  it("parses a call with arguments", () => {
    expect(parse('IF({Amount} > 0, "yes", "no")')).toEqual({
      t: "call",
      fn: "IF",
      args: [
        { t: "bin", op: ">", l: { t: "field", id: AMOUNT }, r: { t: "num", v: 0 } },
        { t: "str", v: "yes" },
        { t: "str", v: "no" },
      ],
    });
  });

  it("normalises the name to uppercase", () => {
    expect((parse("upper({Amount})") as { fn: string }).fn).toBe("UPPER");
  });

  it("parses a zero-argument call", () => {
    expect(parse("TODAY()")).toEqual({ t: "call", fn: "TODAY", args: [] });
  });

  it("checks arity WHILE TYPING, and says what the signature is", () => {
    // The user should learn a formula is wrong before they save it, not after the
    // column silently renders blank forever.
    expect(() => parse("LEFT({Amount})")).toThrow(/takes 2 arguments, got 1/);
    expect(() => parse("LEFT({Amount})")).toThrow(/LEFT\(text, n\)/);
  });

  it("accepts a variadic function with any number of args", () => {
    expect(() => parse("CONCAT({Amount})")).not.toThrow();
    expect(() => parse('CONCAT({Amount}, " x ", {Quantity})')).not.toThrow();
  });

  it("rejects an unknown function by name", () => {
    expect(() => parse("VLOOKUP({Amount})")).toThrow(/Unknown function: VLOOKUP/);
  });
});

describe("literals and operators", () => {
  it("parses strings with either quote", () => {
    expect(parse('"hi"')).toEqual({ t: "str", v: "hi" });
    expect(parse("'hi'")).toEqual({ t: "str", v: "hi" });
  });

  it("parses booleans", () => {
    expect(parse("TRUE")).toEqual({ t: "bool", v: true });
    expect(parse("false")).toEqual({ t: "bool", v: false });
  });

  it("parses unary minus", () => {
    expect(parse("-{Amount}")).toEqual({
      t: "un",
      op: "-",
      a: { t: "field", id: AMOUNT },
    });
  });

  it("normalises != and <> to one operator", () => {
    expect((parse("1 <> 2") as { op: string }).op).toBe("!=");
    expect((parse("1 != 2") as { op: string }).op).toBe("!=");
  });

  it("parses the string-concat operator", () => {
    expect((parse('{Amount} & " units"') as { op: string }).op).toBe("&");
  });
});

describe("errors", () => {
  it("reports an unclosed brace helpfully", () => {
    expect(() => parse("{Amount")).toThrow(/Unclosed \{/);
  });

  it("reports an unclosed string", () => {
    expect(() => parse('"hi')).toThrow(/Unclosed string/);
  });

  it("rejects trailing input rather than silently ignoring it", () => {
    // `1 + 2 3` is a typo, not a formula. Parsing the prefix and dropping the rest
    // would give the user a formula that quietly isn't what they wrote.
    expect(() => parse("1 + 2 3")).toThrow(/trailing input/);
  });

  it("carries a position so the editor can point at the mistake", () => {
    try {
      parse("1 + {Nope}");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      expect((e as FormulaError).position).toBe(4);
    }
  });
});

describe("formulaDependencies", () => {
  it("collects every field a formula touches", () => {
    const ast = parse("IF({Amount} > 0, {Quantity} * 2, {Amount})");
    expect(formulaDependencies(ast)).toEqual(new Set([AMOUNT, QTY]));
  });

  it("returns nothing for a formula with no fields", () => {
    expect(formulaDependencies(parse("1 + 1"))).toEqual(new Set());
  });
});

describe("renderFormula", () => {
  it("round-trips through the parser", () => {
    const src = 'IF(({Amount} > 100), "big", "small")';
    const ast = parse(src);
    const rendered = renderFormula(ast, byId);

    // Rendering then reparsing must give the same tree — otherwise opening a
    // formula and saving it unchanged would corrupt it.
    expect(parse(rendered)).toEqual(ast);
  });

  it("marks a deleted field rather than rendering an empty brace", () => {
    const ast = parse("{Amount}");
    expect(renderFormula(ast, new Map())).toBe("{deleted field}");
  });
});
