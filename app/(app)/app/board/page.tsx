import { redirect } from "next/navigation";
import { store } from "@/storage/store";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { BoardPage } from "@/components/board/board-page";

// The board reflects the live dataset list + rows, so render dynamically.
export const dynamic = "force-dynamic";

export default async function KanbanBoardPage() {
  if (isSupabaseConfigured) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/sign-in");
  }

  const datasets = await store.list();
  return <BoardPage datasets={datasets} />;
}
