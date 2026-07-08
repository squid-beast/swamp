import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { TaskBoard } from "@/components/board/task-board";

// The task board reads/writes live via the browser Supabase client (RLS-scoped),
// so this route only needs to gate access and hand off the owner id.
export const dynamic = "force-dynamic";

export default async function KanbanBoardPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto w-full max-w-lg p-4 text-sm text-muted-foreground md:p-6">
        The Kanban board needs Supabase. Add your keys to enable it.
      </div>
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  return <TaskBoard userId={user.id} />;
}
