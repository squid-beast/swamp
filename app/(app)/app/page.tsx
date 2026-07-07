import { Suspense } from "react";
import { store } from "@/storage/store";
import { Home } from "@/components/Home";

export const dynamic = "force-dynamic";

export default async function Page() {
  const datasets = await store.list();
  return (
    <Suspense>
      <Home initial={datasets} />
    </Suspense>
  );
}
