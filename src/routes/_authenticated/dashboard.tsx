import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMatches, getTeams, getMyPredictions, getLeaderboard, getMyProfile,
} from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { matchStatus, STAGE_LABEL } from "@/lib/scoring";
import { Trophy, Target, TrendingUp, Calendar, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — WC 2026 Predictor" }] }),
  component: Dashboard,
});

function Dashboard() {
  const mFn = useServerFn(getMatches);
  const tFn = useServerFn(getTeams);
  const pFn = useServerFn(getMyPredictions);
  const lFn = useServerFn(getLeaderboard);
  const meFn = useServerFn(getMyProfile);

  const { data: matches = [] } = useQuery({ queryKey: ["matches"], queryFn: () => mFn() });
  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => tFn() });
  const { data: myPreds } = useQuery({ queryKey: ["myPredictions"], queryFn: () => pFn() });
  const { data: leaderboard = [] } = useQuery({ queryKey: ["leaderboard"], queryFn: () => lFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const upcoming = matches
    .filter((m) => matchStatus(m.kickoff_at, m.status) === "open")
    .slice(0, 5);

  const predMap = new Map((myPreds?.predictions ?? []).map((p) => [p.match_id, p]));
  const openMatches = matches.filter((m) => matchStatus(m.kickoff_at, m.status) === "open");
  const openWithoutPred = openMatches.filter((m) => !predMap.has(m.id)).length;

  const myRow = leaderboard.find((r) => r.user_id === me?.profile?.id);
  const myRank = myRow ? leaderboard.findIndex((r) => r.user_id === myRow.user_id) + 1 : null;

  return (
    <div className="space-y-8">
      <section
        className="rounded-2xl p-6 md:p-8 text-primary-foreground"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="text-sm uppercase tracking-wider text-primary-foreground/80 font-medium">
          Welcome back
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">
          {me?.profile?.name ?? "Player"}
        </h1>
        <p className="text-primary-foreground/85 mt-2">
          {openWithoutPred > 0
            ? `You have ${openWithoutPred} open match${openWithoutPred === 1 ? "" : "es"} still to predict.`
            : "You're all caught up on predictions."}
        </p>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Trophy className="h-5 w-5" />} label="Total points" value={myRow?.total ?? 0} />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Leaderboard rank" value={myRank ? `#${myRank}` : "—"} hint={`of ${leaderboard.length}`} />
        <StatCard icon={<Target className="h-5 w-5" />} label="Predictions made" value={myPreds?.predictions.length ?? 0} />
        <StatCard icon={<Calendar className="h-5 w-5" />} label="Open matches" value={openMatches.length} />
      </section>

      <section className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <SectionHeader title="Upcoming matches" linkTo="/matches" linkLabel="All matches" />
          {upcoming.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No upcoming matches yet.</Card>
          ) : (
            <div className="space-y-3">
              {upcoming.map((m) => {
                const home = teamMap.get(m.home_team_id);
                const away = teamMap.get(m.away_team_id);
                const has = predMap.has(m.id);
                return (
                  <Link to="/matches" key={m.id}>
                    <Card className="p-4 hover:border-primary/40 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="text-xs font-normal">
                          {STAGE_LABEL[m.stage]}{m.group_letter ? ` · Group ${m.group_letter}` : ""}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(m.kickoff_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="font-medium">{home?.name}</span>
                          <span className="text-2xl">{home?.flag_emoji}</span>
                        </div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">vs</div>
                        <div className="flex items-center gap-2 justify-start">
                          <span className="text-2xl">{away?.flag_emoji}</span>
                          <span className="font-medium">{away?.name}</span>
                        </div>
                      </div>
                      <div className="mt-3 text-xs text-center">
                        {has ? (
                          <span className="text-primary font-medium">Prediction submitted</span>
                        ) : (
                          <span className="text-destructive font-medium">No prediction yet</span>
                        )}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <SectionHeader title="Top players" linkTo="/leaderboard" linkLabel="Full leaderboard" />
          <Card className="divide-y divide-border overflow-hidden">
            {leaderboard.slice(0, 5).map((r, i) => (
              <div key={r.user_id} className="flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-sm w-6 text-muted-foreground">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.department ?? "—"}</div>
                </div>
                <span className="font-bold text-primary">{r.total}</span>
              </div>
            ))}
            {leaderboard.length === 0 && <div className="p-4 text-sm text-muted-foreground">No players yet.</div>}
          </Card>

          <SectionHeader title="Quick links" />
          <div className="grid grid-cols-2 gap-2">
            <QuickLink to="/matches" label="Matches" />
            <QuickLink to="/top3" label="Top 3 pick" />
            <QuickLink to="/leaderboard" label="Leaderboard" />
            <QuickLink to="/rules" label="Rules" />
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider font-medium">
        {icon} {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );
}

function SectionHeader({ title, linkTo, linkLabel }: { title: string; linkTo?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      {linkTo && linkLabel && (
        <Link to={linkTo as any} className="text-xs font-medium text-primary inline-flex items-center hover:underline">
          {linkLabel} <ArrowRight className="h-3 w-3 ml-1" />
        </Link>
      )}
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to as any} className="block">
      <Card className="p-3 text-sm font-medium hover:border-primary/40 transition-colors text-center">{label}</Card>
    </Link>
  );
}
