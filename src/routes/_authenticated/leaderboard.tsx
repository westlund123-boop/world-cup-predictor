import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getLeaderboard } from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — WC 2026 Predictor" }] }),
  component: Leaderboard,
});

function Leaderboard() {
  const fn = useServerFn(getLeaderboard);
  const { data: rows = [] } = useQuery({ queryKey: ["leaderboard"], queryFn: () => fn() });

  const [filter, setFilter] = useState("");
  const [dept, setDept] = useState("");

  const departments = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { if (r.department) s.add(r.department); });
    return Array.from(s).sort();
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (dept && r.department !== dept) return false;
    if (filter && !r.name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">{rows.length} players · live ranking</p>
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

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filtered.slice(0, 3).map((r, i) => (
            <Card
              key={r.user_id}
              className={`p-5 ${i === 0 ? "border-primary/40 shadow-[var(--shadow-elegant)]" : ""}`}
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
                  <div className="font-semibold truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.department ?? "—"}</div>
                </div>
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-3xl font-bold text-primary">{r.total}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">points</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Rank</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Dept</th>
                <th className="px-4 py-3 text-right">Match pts</th>
                <th className="px-4 py-3 text-right">Top 3</th>
                <th className="px-4 py-3 text-right">Picks</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r, i) => (
                <tr key={r.user_id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-muted-foreground">#{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={r.avatar_url ?? undefined} />
                        <AvatarFallback className="text-xs">{r.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{r.department ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.match_points}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.top3_points}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.predictions_made}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary">{r.total}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
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
