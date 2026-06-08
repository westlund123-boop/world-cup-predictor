import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getCachedLeaderboard } from "@/lib/admin.functions";
import { getMyProfile } from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Info, Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — WC 2026 Predictor" }] }),
  component: Leaderboard,
});

function Leaderboard() {
  const fn = useServerFn(getCachedLeaderboard);
  const meFn = useServerFn(getMyProfile);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["leaderboard-cache"], queryFn: () => fn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });

  const [filter, setFilter] = useState("");
  const [dept, setDept] = useState("");

  const departments = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r: any) => { if (r.department) s.add(r.department); });
    return Array.from(s).sort();
  }, [rows]);

  const filtered = rows.filter((r: any) => {
    if (dept && r.department !== dept) return false;
    if (filter && !r.name?.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const myId = me?.profile?.id;
  const myRank = myId ? rows.findIndex((r: any) => r.user_id === myId) + 1 : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rows.length} players
            {myRank > 0 && <> · You are <span className="text-primary font-semibold">#{myRank}</span></>}
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Info className="h-4 w-4 mr-1.5" /> Tie-breakers
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="text-sm w-80">
            <p className="font-semibold mb-2">If two players are tied on total points:</p>
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
              <li>Most exact scores</li>
              <li>Most correct 1 / X / 2 picks</li>
              <li>Most goalscorer points</li>
              <li>Earliest Top 3 submission</li>
            </ol>
          </PopoverContent>
        </Popover>
      </header>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading leaderboard…</Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filtered.slice(0, 3).map((r: any, i: number) => {
            const mine = r.user_id === myId;
            return (
              <Card
                key={r.user_id}
                className={`p-5 ${i === 0 ? "border-primary/40 shadow-[var(--shadow-elegant)]" : ""} ${mine ? "ring-2 ring-primary/40" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-full font-bold text-sm ${
                    i === 0 ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}>
                    {i === 0 ? <Trophy className="h-5 w-5" /> : `#${i + 1}`}
                  </div>
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={r.avatar_url ?? undefined} />
                    <AvatarFallback>{r.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{r.name} {mine && <span className="text-xs text-primary">(you)</span>}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.department ?? "—"}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-primary">{r.total}</span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">points</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Rank</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Dept</th>
                <th className="px-4 py-3 text-right hidden md:table-cell" title="Outcome + exact/diff/total">Match</th>
                <th className="px-4 py-3 text-right hidden md:table-cell" title="First scorer + other scorers">Scorers</th>
                <th className="px-4 py-3 text-right hidden lg:table-cell" title="Correct KO advancement & winner">KO</th>
                <th className="px-4 py-3 text-right hidden lg:table-cell" title="Champion / Silver / Bronze">Top 3</th>
                <th className="px-4 py-3 text-right hidden lg:table-cell" title="Top Scorer League ranked picks">Top Scorers</th>
                <th className="px-4 py-3 text-right hidden xl:table-cell" title="Exact score predictions">✓ Exact</th>
                <th className="px-4 py-3 text-right hidden xl:table-cell" title="Correct 1X2 outcome">✓ 1X2</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r: any, i: number) => {
                const mine = r.user_id === myId;
                return (
                  <tr key={r.user_id} className={`hover:bg-muted/30 ${mine ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      <span className={mine ? "text-primary font-bold" : ""}>#{i + 1}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={r.avatar_url ?? undefined} />
                          <AvatarFallback className="text-xs">{r.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{r.name}{mine && <span className="text-primary ml-1 text-xs">(you)</span>}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{r.department ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono hidden md:table-cell">{r.match_points}</td>
                    <td className="px-4 py-3 text-right font-mono hidden md:table-cell">{r.goalscorer_points}</td>
                    <td className="px-4 py-3 text-right font-mono hidden lg:table-cell">{r.knockout_points}</td>
                    <td className="px-4 py-3 text-right font-mono hidden lg:table-cell">{r.top3_points}</td>
                    <td className="px-4 py-3 text-right font-mono hidden xl:table-cell">{r.exact_count}</td>
                    <td className="px-4 py-3 text-right font-mono hidden xl:table-cell">{r.onextwo_count}</td>
                    <td className="px-4 py-3 text-right font-bold text-primary">{r.total}</td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No players match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
