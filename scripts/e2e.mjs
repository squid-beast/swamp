/* End-to-end API test. Exercises the full pipeline against a running server:
   import (webhook + file upload) → inference → field registry overrides →
   row updates (status changes) → row deletes → dataset delete.

   Run:  npm run build && npm run start   (or npm run dev)
   Then: node scripts/e2e.mjs [baseUrl]
*/
const BASE = process.argv[2] ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
const fail = (name, detail) => {
  failed++;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
};
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

const json = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

// ── 1. webhook import: 8 rows so select/status inference kicks in (needs ≥6) ──
const stages = ["todo", "in progress", "done", "todo", "in progress", "done", "todo", "done"];
const webhookPayload = {
  data: stages.map((stage, i) => ({
    task: `Task ${i + 1}`,
    owner_email: `owner${i}@example.com`,
    budget: `$${(100 + i * 25).toFixed(2)}`,
    stage,
    due: `2026-08-${String(i + 1).padStart(2, "0")}`,
    meta: { source: "e2e", index: i },
  })),
};

const res1 = await json("POST", "/api/datasets?name=E2E%20Webhook", webhookPayload);
assert(res1.ok, "POST raw JSON webhook returns 200", `status ${res1.status}`);
const { id: webhookId } = await res1.json();
assert(typeof webhookId === "string" && webhookId.startsWith("ds_"), "webhook import returns dataset id");

// ── 2. GET dataset: inference + flatten checks ──
const res2 = await json("GET", `/api/datasets/${webhookId}`);
assert(res2.ok, "GET dataset returns 200", `status ${res2.status}`);
const { dataset, rows } = await res2.json();
assert(rows.length === 8, "row count matches payload", `got ${rows.length}`);

const typeOf = (src) => dataset.fields.find((f) => f.sourceName === src)?.type;
assert(typeOf("owner_email") === "email", "email inferred", `got ${typeOf("owner_email")}`);
assert(typeOf("budget") === "currency", "currency inferred", `got ${typeOf("budget")}`);
assert(typeOf("due") === "date", "date inferred", `got ${typeOf("due")}`);
assert(typeOf("stage") === "status" || typeOf("stage") === "singleSelect", "stage inferred as select/status", `got ${typeOf("stage")}`);
assert(typeOf("meta.source") === "text" || typeOf("meta.source") !== undefined, "nested object flattened (meta.source)", "missing meta.source");

const stageField = dataset.fields.find((f) => f.sourceName === "stage");
const optionValues = (stageField?.options ?? []).map((o) => o.value).sort();
assert(
  JSON.stringify(optionValues) === JSON.stringify(["done", "in progress", "todo"]),
  "stage options detected (todo / in progress / done)",
  optionValues.join(",")
);

// ── 3. overrides: rename + hide, then verify persisted ──
const firstField = dataset.fields[0];
const res3 = await json("PATCH", `/api/datasets/${webhookId}`, {
  overrides: { [firstField.id]: { displayName: "Renamed by e2e", hidden: true } },
});
assert(res3.ok, "PATCH overrides returns 200", `status ${res3.status}`);
const after3 = await (await json("GET", `/api/datasets/${webhookId}`)).json();
assert(
  after3.dataset.overrides[firstField.id]?.displayName === "Renamed by e2e" &&
    after3.dataset.overrides[firstField.id]?.hidden === true,
  "override persisted (rename + hide)"
);

// ── 4. row update: change stage of two rows (the status-edit path) ──
const targetRows = rows.slice(0, 2).map((r) => r.__id);
const res4 = await json("PATCH", `/api/datasets/${webhookId}/rows`, {
  patches: targetRows.map((__id) => ({ __id, values: { [stageField.id]: "done" } })),
});
assert(res4.ok, "PATCH rows returns 200", `status ${res4.status}`);
const after4 = await (await json("GET", `/api/datasets/${webhookId}`)).json();
assert(
  targetRows.every((id) => after4.rows.find((r) => r.__id === id)?.[stageField.id] === "done"),
  "bulk status change persisted on both rows"
);
assert(
  JSON.stringify(after4.dataset.fields) === JSON.stringify(dataset.fields),
  "row update left the field registry untouched"
);

// ── 4b. row update guards ──
const resBadPatch = await json("PATCH", `/api/datasets/${webhookId}/rows`, { patches: "nope" });
assert(resBadPatch.status === 400, "invalid patches rejected with 400", `status ${resBadPatch.status}`);
const resInject = await json("PATCH", `/api/datasets/${webhookId}/rows`, {
  patches: [{ __id: targetRows[0], values: { evil_unknown_field: "x" } }],
});
const afterInject = await (await json("GET", `/api/datasets/${webhookId}`)).json();
assert(
  resInject.ok && !("evil_unknown_field" in afterInject.rows.find((r) => r.__id === targetRows[0])),
  "unknown field ids are stripped from patches"
);

// ── 5. row delete ──
const res5 = await json("DELETE", `/api/datasets/${webhookId}/rows`, { rowIds: [targetRows[0]] });
assert(res5.ok, "DELETE rows returns 200", `status ${res5.status}`);
const del5 = await res5.json();
assert(del5.rowCount === 7, "rowCount decremented to 7", `got ${del5.rowCount}`);
const after5 = await (await json("GET", `/api/datasets/${webhookId}`)).json();
assert(after5.rows.length === 7 && after5.dataset.rowCount === 7, "row delete persisted in rows + meta");

// ── 6. multipart CSV upload ──
const csv = ["name,email,amount", "Ada,ada@x.com,$10.00", "Lin,lin@x.com,$12.50"].join("\n");
const fd = new FormData();
fd.append("file", new Blob([csv], { type: "text/csv" }), "e2e-upload.csv");
const res6 = await fetch(`${BASE}/api/datasets`, { method: "POST", body: fd });
assert(res6.ok, "POST multipart CSV upload returns 200", `status ${res6.status}`);
const { id: csvId } = await res6.json();
const csvDs = await (await json("GET", `/api/datasets/${csvId}`)).json();
assert(csvDs.rows.length === 2, "CSV rows imported", `got ${csvDs.rows.length}`);
assert(
  csvDs.dataset.fields.find((f) => f.sourceName === "email")?.type === "email",
  "CSV inference ran (email)"
);

// ── 7. list contains both, then cleanup + 404 ──
const list = await (await json("GET", "/api/datasets")).json();
assert(
  list.some((d) => d.id === webhookId) && list.some((d) => d.id === csvId),
  "GET list contains both new datasets"
);
for (const id of [webhookId, csvId]) {
  const del = await json("DELETE", `/api/datasets/${id}`);
  assert(del.ok, `DELETE dataset ${id}`);
}
const gone = await json("GET", `/api/datasets/${webhookId}`);
assert(gone.status === 404, "deleted dataset returns 404", `status ${gone.status}`);

// ── summary ──
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
