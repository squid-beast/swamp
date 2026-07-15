/**
 * Derive a stable, unique storage key for a new field.
 *
 * Pure, and deliberately NOT in repo.ts — that module is `server-only`, and this
 * needs to be reachable from a unit test and (later) from a client-side "add
 * field" form that previews the key.
 *
 * ── Why the key is frozen ──
 *
 * The key is what lives in `record.data`. It must NEVER change:
 *
 *   • A rename has to be free. Users rename columns constantly, and rewriting
 *     every record's JSONB to match would be absurd.
 *   • Formulas reference fields by ID, not by name — for exactly the same reason.
 *
 * So the key is derived from the name ONCE, at creation, and then frozen. Create
 * a field called "Amt" and later rename it to "Contract value" and the key stays
 * `fld_amt`. That looks odd in the database and is exactly right.
 */
export function deriveFieldKey(name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";

  let key = `fld_${slug}`;
  let n = 2;
  // Two columns called "Name" is not a mistake — real CSVs do it. The second must
  // get its own key, or its values land on top of the first's.
  while (taken.has(key)) key = `fld_${slug}_${n++}`;
  return key;
}
