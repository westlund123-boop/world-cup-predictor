import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WC 2026 Predictor — Sign in" },
      { name: "description", content: "Company FIFA World Cup 2026 prediction competition." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) navigate({ to: "/dashboard", replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Signed in");
      navigate({ to: "/dashboard", replace: true });
    }
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Password reset email sent. Check your inbox.");
      setForgotOpen(false);
      setForgotEmail("");
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Hero */}
      <div
        className="relative hidden md:flex flex-col justify-between p-12 text-primary-foreground overflow-hidden"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="relative z-10 flex items-center gap-3 text-xl font-bold">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary-foreground/15 backdrop-blur">
            <Trophy className="h-6 w-6" />
          </div>
          WC 2026 Predictor
        </div>
        <div className="relative z-10 space-y-6">
          <h1 className="text-5xl font-bold tracking-tight leading-[1.05]">
            Predict every match.<br />Top the company leaderboard.
          </h1>
          <p className="text-lg text-primary-foreground/85 max-w-md">
            Submit picks for all 104 matches, predict the medalists, and battle your colleagues for the title of office oracle.
          </p>
          <div className="flex gap-8 pt-4 text-sm">
            <div><div className="text-3xl font-bold">48</div><div className="text-primary-foreground/75">Teams</div></div>
            <div><div className="text-3xl font-bold">104</div><div className="text-primary-foreground/75">Matches</div></div>
            <div><div className="text-3xl font-bold">12</div><div className="text-primary-foreground/75">Groups</div></div>
          </div>
        </div>
        <div className="relative z-10 text-sm text-primary-foreground/70">
          Internal employee competition
        </div>
      </div>

      {/* Login */}
      <div className="flex items-center justify-center p-6 md:p-12 bg-background">
        <Card className="w-full max-w-md p-8 border-border shadow-[var(--shadow-card)]">
          <div className="md:hidden flex items-center gap-2 mb-6 text-lg font-bold">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Trophy className="h-5 w-5" />
            </div>
            WC 2026 Predictor
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-1">Welcome back. Make your picks.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground mt-6 text-center">
            New here?{" "}
            <Link to="/auth" className="text-primary font-medium hover:underline">
              Create an account
            </Link>
          </p>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            <Link to="/rules" className="hover:text-foreground hover:underline">View competition rules →</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
