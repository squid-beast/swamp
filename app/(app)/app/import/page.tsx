import { Suspense } from "react";
import { store } from "@/features/datasets/storage/store";
import { Home } from "@/features/overview/components/Home";

// The data page: upload / connect a source, and see existing datasets. The
// greeting overview lives at /app; this is where "Import data" points.
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const datasets = await store.list();
  return (
    <Suspense>
      <Home initial={datasets} />
    </Suspense>
  );
}
