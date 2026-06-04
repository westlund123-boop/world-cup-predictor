import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { getMyProfile } from "@/lib/wc.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
    return { user: data.user };
  },
  component: AuthLayout,
});

function AuthLayout() {
  const fn = useServerFn(getMyProfile);
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => fn() });
  return (
    <div className="min-h-screen bg-background">
      <AppHeader isAdmin={data?.isAdmin} />
      <main className="container mx-auto px-4 py-6 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
