import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Trophy, LogOut } from "lucide-react";

export function AppHeader({ isAdmin }: { isAdmin?: boolean }) {
  const navigate = useNavigate();
  const links = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/matches", label: "Matches" },
    { to: "/top3", label: "Top 3" },
    { to: "/leaderboard", label: "Leaderboard" },
    { to: "/rules", label: "Rules" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link to="/dashboard" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </div>
          <span className="hidden sm:inline">WC 2026 Predictor</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              activeProps={{ className: "text-primary bg-accent" }}
            >
              {l.label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              to="/admin"
              className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              activeProps={{ className: "text-primary bg-accent" }}
            >
              Admin
            </Link>
          )}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="h-4 w-4 mr-1" /> Sign out
        </Button>
      </div>
      <nav className="md:hidden flex overflow-x-auto gap-1 px-3 py-2 border-t border-border">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground whitespace-nowrap"
            activeProps={{ className: "text-primary bg-accent" }}
          >
            {l.label}
          </Link>
        ))}
        {isAdmin && (
          <Link
            to="/admin"
            className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground whitespace-nowrap"
            activeProps={{ className: "text-primary bg-accent" }}
          >
            Admin
          </Link>
        )}
      </nav>
    </header>
  );
}
