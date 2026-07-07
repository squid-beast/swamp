/* Seeds three fixture datasets exercising every inferred type.
   Run: npm run seed */
import fs from "fs";
import path from "path";
import { parseCSV, parseJSON, ingest } from "../engine/import";

const FIX = path.join(process.cwd(), "fixtures");
const DATA = path.join(process.cwd(), "data");

// 1. DTC brand leads (CRM-shaped: email, phone, currency, status, url, date, bool)
const first = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Isla", "Kai", "Nora", "Leo", "Ivy", "Max", "Ruby", "Finn", "Elle", "Jude", "Sage", "Cole", "Wren", "Beau"];
const brands = ["Jones Road", "Dossier", "Odele", "Cocokind", "Rhode", "Glow Recipe", "Ilia", "Kosas", "Saie", "Tower 28"];
const stages = ["New", "Contacted", "Sample Sent", "In Review", "Won", "Lost"];
const channels = ["Instagram", "Email", "Referral", "TikTok"];
const leadRows = Array.from({ length: 60 }, (_, i) => {
  const f = first[i % first.length];
  const b = brands[i % brands.length];
  return {
    contact_name: `${f} ${["Chen", "Patel", "Kim", "Lopez", "Ross"][i % 5]}`,
    brand: b,
    email: `${f.toLowerCase()}@${b.toLowerCase().replace(/\s/g, "")}.com`,
    phone: `+1 (${300 + (i % 600)}) 555-${String(1000 + i * 37).slice(0, 4)}`,
    deal_value: `$${(1500 + (i * 731) % 9000).toLocaleString()}`,
    stage: stages[(i * 7) % stages.length],
    channel: channels[i % channels.length],
    website: `https://${b.toLowerCase().replace(/\s/g, "")}.com`,
    sample_sent: i % 3 === 0 ? "true" : "false",
    last_touch: new Date(2026, 5, 1 + (i % 30)).toISOString().slice(0, 10),
    notes: i % 4 === 0 ? "Responded positively to the free-sample-first pitch. Wants Vox-style paper-cut format for the summer drop. Follow up after their launch week settles down." : "Warm intro pending",
  };
});

// 2. Ad campaign performance (numbers, percent, currency, multi-select, image)
const imgs = [1015, 1025, 1035, 1045, 1055, 1065, 1074, 1084];
const formats = ["UGC Reel", "Product Reel", "Viral Ad", "Lookbook", "Motion Design"];
const campaignRows = Array.from({ length: 40 }, (_, i) => ({
  campaign: `${brands[i % brands.length]} · ${formats[i % formats.length]} v${1 + (i % 3)}`,
  creative_image: `https://picsum.photos/id/${imgs[i % imgs.length]}/400/300`,
  platform: ["Meta", "TikTok", "YouTube"][i % 3],
  spend: `$${(120 + (i * 97) % 2400).toFixed(2)}`,
  impressions: String(9000 + (i * 8317) % 220000),
  ctr: `${(0.7 + ((i * 13) % 42) / 10).toFixed(1)}%`,
  roas: (0.8 + ((i * 29) % 46) / 10).toFixed(1),
  tags: [formats[i % formats.length], ["hook-a", "hook-b", "hook-c"][i % 3]].join(", "),
  status: ["Active", "Paused", "Draft", "Complete"][(i * 3) % 4],
  launched: new Date(2026, 4 + (i % 2), 1 + (i % 28)).toISOString().slice(0, 10),
}));

// 3. Webhook-shaped orders JSON (nested payload → flatten + json type)
const orders = {
  data: Array.from({ length: 35 }, (_, i) => ({
    order_id: `ORD-${7000 + i}`,
    customer: { name: `${first[(i * 3) % first.length]} ${["Ward", "Diaz", "Nash"][i % 3]}`, email: `buyer${i}@gmail.com` },
    total: 24.99 + (i * 13.5) % 180,
    currency: "USD",
    fulfillment: ["Pending", "Shipped", "Delivered", "Refunded"][(i * 5) % 4],
    items: [{ sku: `SKU-${100 + i}`, qty: 1 + (i % 3) }],
    placed_at: new Date(2026, 6, 1, 8 + (i % 12), (i * 7) % 60).toISOString(),
    gift: i % 5 === 0,
  })),
};

function toCSV(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function reset() {
  if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(FIX, { recursive: true });
}

function save(name: string, kind: "csv" | "json" | "webhook", table: ReturnType<typeof parseCSV>) {
  const { dataset, rows } = ingest(name, { kind }, table);
  fs.writeFileSync(path.join(DATA, `${dataset.id}.meta.json`), JSON.stringify(dataset, null, 1));
  fs.writeFileSync(path.join(DATA, `${dataset.id}.rows.json`), JSON.stringify(rows));
  console.log(`✓ ${name}: ${rows.length} rows, ${dataset.fields.length} fields, views [${dataset.views.map((v) => v.type).join(", ")}]`);
  for (const f of dataset.fields) console.log(`   ${f.sourceName.padEnd(16)} → ${f.type} (${f.confidence})`);
}

reset();
const leadsCSV = toCSV(leadRows);
const campaignsCSV = toCSV(campaignRows);
fs.writeFileSync(path.join(FIX, "leads.csv"), leadsCSV);
fs.writeFileSync(path.join(FIX, "campaigns.csv"), campaignsCSV);
fs.writeFileSync(path.join(FIX, "orders.json"), JSON.stringify(orders, null, 2));

save("DTC Outreach Pipeline", "csv", parseCSV(leadsCSV));
save("Ad Campaign Performance", "csv", parseCSV(campaignsCSV));
save("Shopify Orders (webhook)", "webhook", parseJSON(JSON.stringify(orders)));
console.log("\nSeeded. Run: npm run dev");
