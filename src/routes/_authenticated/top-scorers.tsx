import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  getPlayers,
  getTeams,
  getMatches,
  getMyTopScorerLeague,
  upsertTopScorerLeague,
  getTopScorerStandings,
  getMyProfile,
} from "@/lib/wc.functions";
import {
  adminListTopScorerEntries,
  adminGrantTopScorerUnlock,
  adminRevokeTopScorerUnlock,
} from "@/lib/admin.functions";
import { scoreTopScorerLeague } from "@/lib/scoring";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ListOrdered, Lock, Trophy, Unlock, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/top-scorers")({
  head: () => ({ meta: [{ title: "Top Scorer League — WC 2026 Predictor" }] }),
  component: TopScorersPage,
});

type Player = {
  id: string;
  name: string;
  name_on_shirt: string | null;
  team_id: string;
  shirt_number: number | null;
  position: string | null;
};

function TopScorersPage() {
  const playersFn = useServerFn(getPlayers);
  const teamsFn = useServerFn(getTeams);
  const matchesFn = useServerFn(getMatches);
  const myFn = useServerFn(getMyTopScorerLeague);
  const saveFn = useServerFn(upsertTopScorerLeague);
  const standingsFn = useServerFn(getTopScorerStandings);
  const meFn = useServerFn(getMyProfile);

  const { data: players = [] } = useQuery({ queryKey: ["players"], queryFn: () => playersFn() });
  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => teamsFn() });
  const { data: matches = [] } = useQuery({ queryKey: ["matches"], queryFn: () => matchesFn() });
  const { data: my } = useQuery({ queryKey: ["myTopScorerLeague"], queryFn: () => myFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data: standings = [] } = useQuery({
    queryKey: ["topScorerStandings"],
    queryFn: () => standingsFn(),
  });

  const isAdmin = !!me?.isAdmin;
  const hasUnlock = !!my?.hasUnlock;

  const teamById = useMemo(
    () => new Map(teams.map((t) => [t.id, t])),
    [teams]
  );
  const playerById = useMemo<Map<string, Player>>(
    () => new Map(players.map((p) => [p.id, p as Player])),
    [players]
  );

  // Forward-only attackers/mids tend to be the realistic picks, but allow all.
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => a.name.localeCompare(b.name));
  }, [players]);

  const firstMatch = useMemo(
    () => [...matches].sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime())[0],
    [matches]
  );
  const tournamentStarted = !!firstMatch && new Date(firstMatch.kickoff_at) <= new Date();
  const locked = tournamentStarted && !hasUnlock;

  const [picks, setPicks] = useState<(string | null)[]>(() => new Array(10).fill(null));
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (my?.picks && my.picks.length > 0) {
      const arr: (string | null)[] = new Array(10).fill(null);
      for (const p of my.picks) {
        if (p.rank >= 1 && p.rank <= 10) arr[p.rank - 1] = p.player_id;
      }
      setPicks(arr);
    }
  }, [my]);

  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          picks: picks.map((player_id, i) => ({ rank: i + 1, player_id: player_id! })),
        },
      }),
    onSuccess: () => {
      toast.success("Top Scorer League list saved");
      qc.invalidateQueries({ queryKey: ["myTopScorerLeague"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["leaderboard-cache"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allFilled = picks.every(Boolean);
  const allUnique = new Set(picks.filter(Boolean)).size === picks.filter(Boolean).length;

  // Build actual rank map for live scoring preview
  const actualRankByPlayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of standings) m.set(s.player_id, s.rank);
    return m;
  }, [standings]);

  const livePoints = useMemo(
    () => scoreTopScorerLeague(picks, actualRankByPlayer),
    [picks, actualRankByPlayer]
  );

  function setPickAt(idx: number, value: string) {
    setPicks((prev) => {
      const next = [...prev];
      next[idx] = value || null;
      return next;
    });
  }

  function teamLabel(team_id: string | null) {
    if (!team_id) return "";
    const t = teamById.get(team_id);
    return t ? `${t.flag_emoji ?? ""} ${t.code}` : "";
  }

  const filteredPlayerOptions = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return sortedPlayers.filter((p) => {
      if (!f) return true;
      const t = teamById.get(p.team_id);
      return (
        p.name.toLowerCase().includes(f) ||
        (t?.name?.toLowerCase().includes(f) ?? false) ||
        (t?.code?.toLowerCase().includes(f) ?? false)
      );
    });
  }, [sortedPlayers, filter, teamById]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <ListOrdered className="h-5 w-5 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Top Scorer League</h1>
        </div>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Pick your ranked top-10 goalscorers for the tournament. Standings are derived
          automatically from the official scorers entered for each finished match; ties
          on goals share the same rank. Locks at the first match kickoff.
        </p>
      </header>

      {locked && (
        <Card className="p-4 flex items-center gap-3 border-destructive/30 bg-destructive/5">
          <Lock className="h-4 w-4 text-destructive" />
          <span className="text-sm">Top Scorer League predictions are locked — the tournament has started.</span>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Your ranked picks */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Your ranked top 10</h2>
            <span className="text-xs text-muted-foreground">
              Live points: <span className="font-semibold text-primary">{livePoints}</span>
            </span>
          </div>

          {!locked && (
            <Input
              placeholder="Filter players by name or team…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}

          <ol className="space-y-2">
            {picks.map((pid, idx) => {
              const rank = idx + 1;
              const actualRank = pid ? actualRankByPlayer.get(pid) : undefined;
              return (
                <li key={idx} className="flex items-center gap-2">
                  <span className="flex-none grid place-items-center h-7 w-7 rounded-full bg-muted text-xs font-semibold">
                    {rank}
                  </span>
                  <select
                    disabled={locked}
                    value={pid ?? ""}
                    onChange={(e) => setPickAt(idx, e.target.value)}
                    className="flex-1 h-9 px-2 rounded-md border border-input bg-background text-sm disabled:opacity-60"
                  >
                    <option value="">Pick player…</option>
                    {filteredPlayerOptions.map((p) => {
                      const usedByOther = picks.some((q, j) => q === p.id && j !== idx);
                      return (
                        <option key={p.id} value={p.id} disabled={usedByOther}>
                          {teamLabel(p.team_id)} · {p.name}
                          {p.shirt_number ? ` (#${p.shirt_number})` : ""}
                          {usedByOther ? " — already picked" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {pid && (
                    <span className="text-xs text-muted-foreground w-20 text-right tabular-nums">
                      {actualRank ? `Actual #${actualRank}` : "—"}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <Button
            onClick={() => save.mutate()}
            disabled={locked || !allFilled || !allUnique || save.isPending}
            className="w-full"
          >
            {locked
              ? "Locked"
              : save.isPending
              ? "Saving…"
              : my?.parent
              ? "Update top 10"
              : "Submit top 10"}
          </Button>

          {my?.parent && (
            <p className="text-xs text-center text-muted-foreground">
              Earned so far: <span className="font-semibold text-primary">{my.parent.points} pts</span>
            </p>
          )}
        </Card>

        {/* Live actual standings */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Live tournament standings</h2>
          </div>
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No goals have been recorded yet. The chart will fill up automatically as match results come in.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {standings.slice(0, 25).map((s) => {
                const isMine = picks.includes(s.player_id);
                const myRank = isMine ? picks.indexOf(s.player_id) + 1 : null;
                return (
                  <li
                    key={s.player_id}
                    className={`flex items-center gap-3 py-2 ${
                      isMine ? "bg-primary/5 -mx-2 px-2 rounded" : ""
                    }`}
                  >
                    <span className="flex-none w-8 text-right font-mono text-sm text-muted-foreground">
                      #{s.rank}
                    </span>
                    <span className="flex-1 truncate">
                      <span className="text-xs text-muted-foreground mr-1">
                        {teamLabel(s.team_id)}
                      </span>
                      <span className="font-medium">{s.name}</span>
                    </span>
                    <span className="font-mono text-sm tabular-nums w-12 text-right">
                      {s.goals} {s.goals === 1 ? "goal" : "goals"}
                    </span>
                    {myRank && (
                      <span className="text-xs text-primary font-semibold w-16 text-right">
                        Your #{myRank}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <Card className="p-4 text-xs text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">Scoring:</span> 25 pts if you put the
          actual top scorer in your rank-1 slot · 15 pts for any other player in the exact correct
          rank · 5 pts for a predicted player who finishes in the actual top 10 but in the wrong
          rank. Each predicted player counts once.
        </p>
      </Card>
    </div>
  );
}
