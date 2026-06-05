import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  adminGetAllMatches,
  adminEditMatch,
  adminSaveResult,
  adminRecalculate,
  adminExportLeaderboardCSV,
} from "@/lib/admin.functions";
import { getTeams, getPlayers, getMyProfile } from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { STAGE_LABEL, matchStatus } from "@/lib/scoring";
import { Calculator, Download, Pencil, Trophy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — WC 2026 Predictor" }] }),
  component: AdminPage,
});

function AdminPage() {
  const meFn = useServerFn(getMyProfile);
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!me?.isAdmin)
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-bold">Admin only</h1>
        <p className="text-sm text-muted-foreground mt-2">
          You need an admin role to access this page.
        </p>
      </Card>
    );

  return <AdminInner />;
}

function AdminInner() {
  const qc = useQueryClient();
  const mFn = useServerFn(adminGetAllMatches);
  const tFn = useServerFn(getTeams);
  const pFn = useServerFn(getPlayers);
  const recalcFn = useServerFn(adminRecalculate);
  const csvFn = useServerFn(adminExportLeaderboardCSV);

  const { data: bundle } = useQuery({ queryKey: ["admin-matches"], queryFn: () => mFn() });
  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => tFn() });
  const { data: players = [] } = useQuery({ queryKey: ["players"], queryFn: () => pFn() });

  const matches = bundle?.matches ?? [];
  const actualScorersByMatch = useMemo(() => {
    const m = new Map<string, { first: string | null; all: string[] }>();
    for (const g of bundle?.scorers ?? []) {
      const e = m.get(g.match_id) ?? { first: null, all: [] };
      if (g.is_first) e.first = g.player_id;
      e.all.push(g.player_id);
      m.set(g.match_id, e);
    }
    return m;
  }, [bundle]);

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const [stage, setStage] = useState<string>("");
  const [group, setGroup] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [editing, setEditing] = useState<any | null>(null);
  const [resulting, setResulting] = useState<any | null>(null);

  const recalc = useMutation({
    mutationFn: () => recalcFn(),
    onSuccess: (r) => {
      toast.success(`Points recalculated — ${r.users} users updated`);
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["leaderboard-cache"] });
      qc.invalidateQueries({ queryKey: ["myPredictions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = useMutation({
    mutationFn: () => csvFn(),
    onSuccess: (r) => {
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV exported");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = matches.filter((m: any) => {
    if (stage && m.stage !== stage) return false;
    if (group && m.group_letter !== group) return false;
    if (status && m.status !== status) return false;
    if (date && !m.kickoff_at.startsWith(date)) return false;
    return true;
  });

  const stages = ["group", "r32", "r16", "qf", "sf", "third", "final"];
  const groups = Array.from(new Set(matches.map((m: any) => m.group_letter).filter(Boolean))).sort();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin panel</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Enter results, recalculate points, export the leaderboard.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => recalc.mutate()} disabled={recalc.isPending} variant="outline">
            <Calculator className="h-4 w-4 mr-1.5" />
            {recalc.isPending ? "Recalculating…" : "Recalculate points"}
          </Button>
          <Button onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </header>

      <Card className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <Select label="Stage" value={stage} setValue={setStage} options={[["", "All stages"], ...stages.map((s) => [s, STAGE_LABEL[s]] as [string, string])]} />
        <Select label="Group" value={group} setValue={setGroup} options={[["", "All groups"], ...groups.map((g) => [g as string, `Group ${g}`] as [string, string])]} />
        <Select label="Status" value={status} setValue={setStatus} options={[["", "All"], ["scheduled", "Scheduled"], ["live", "Live"], ["finished", "Finished"]]} />
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
        </div>
        <div className="flex items-end">
          <Button variant="ghost" onClick={() => { setStage(""); setGroup(""); setStatus(""); setDate(""); }}>
            Clear filters
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Kickoff</th>
                <th className="px-3 py-2 text-center">Score</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m: any) => {
                const home = m.home_team_id ? teamMap.get(m.home_team_id) : undefined;
                const away = m.away_team_id ? teamMap.get(m.away_team_id) : undefined;
                return (
                  <tr key={m.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="font-normal text-[10px]">
                        {STAGE_LABEL[m.stage]}
                        {m.group_letter ? ` · ${m.group_letter}` : ""}
                        {m.bracket_code ? ` · ${m.bracket_code}` : ""}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span>{home?.flag_emoji ?? "·"}</span>
                        <span className="font-medium">{home?.name ?? m.home_source_code ?? "TBD"}</span>
                        <span className="text-muted-foreground">vs</span>
                        <span className="font-medium">{away?.name ?? m.away_source_code ?? "TBD"}</span>
                        <span>{away?.flag_emoji ?? "·"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(m.kickoff_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {m.home_score !== null && m.away_score !== null ? `${m.home_score}–${m.away_score}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      <StatusTag s={m.status} kickoff={m.kickoff_at} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                        <Pencil className="h-3 w-3 mr-1" />Edit
                      </Button>
                      <Button size="sm" onClick={() => setResulting(m)}>
                        <Trophy className="h-3 w-3 mr-1" />Result
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted-foreground text-sm">
                    No matches match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <EditMatchDialog
          match={editing}
          teams={teams}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin-matches"] });
            qc.invalidateQueries({ queryKey: ["matches"] });
          }}
        />
      )}
      {resulting && (
        <ResultDialog
          match={resulting}
          home={resulting.home_team_id ? teamMap.get(resulting.home_team_id) : undefined}
          away={resulting.away_team_id ? teamMap.get(resulting.away_team_id) : undefined}
          players={players}
          existing={actualScorersByMatch.get(resulting.id)}
          onClose={() => setResulting(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin-matches"] });
            qc.invalidateQueries({ queryKey: ["matches"] });
          }}
        />
      )}
    </div>
  );
}

function Select({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}

function StatusTag({ s, kickoff }: { s: string; kickoff: string }) {
  const cls =
    s === "finished"
      ? "bg-primary/15 text-primary"
      : s === "live"
      ? "bg-destructive/15 text-destructive"
      : matchStatus(kickoff, s) === "locked"
      ? "bg-muted text-muted-foreground"
      : "bg-accent text-accent-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {s}
    </span>
  );
}

function EditMatchDialog({
  match,
  teams,
  onClose,
  onSaved,
}: {
  match: any;
  teams: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kickoff, setKickoff] = useState(match.kickoff_at.slice(0, 16));
  const [home, setHome] = useState<string>(match.home_team_id ?? "");
  const [away, setAway] = useState<string>(match.away_team_id ?? "");
  const fn = useServerFn(adminEditMatch);
  const save = useMutation({
    mutationFn: () =>
      fn({
        data: {
          match_id: match.id,
          kickoff_at: new Date(kickoff).toISOString(),
          home_team_id: home || null,
          away_team_id: away || null,
        },
      }),
    onSuccess: () => {
      toast.success("Match updated");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit match</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Kickoff (local time)</Label>
            <Input type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TeamSelect label="Home team" value={home} setValue={setHome} teams={teams} />
            <TeamSelect label="Away team" value={away} setValue={setAway} teams={teams} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamSelect({
  label,
  value,
  setValue,
  teams,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  teams: any[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
      >
        <option value="">— TBD —</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>
        ))}
      </select>
    </div>
  );
}

function ResultDialog({
  match,
  home,
  away,
  players,
  existing,
  onClose,
  onSaved,
}: {
  match: any;
  home: any;
  away: any;
  players: any[];
  existing?: { first: string | null; all: string[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hs, setHs] = useState<number>(match.home_score ?? 0);
  const [as_, setAs] = useState<number>(match.away_score ?? 0);
  const [status, setStatus] = useState<"scheduled" | "live" | "finished">(match.status);
  const [firstScorer, setFirstScorer] = useState<string>(existing?.first ?? "");
  const [scorers, setScorers] = useState<string[]>(existing?.all ?? []);
  const [winner, setWinner] = useState<string>(match.winner_team_id ?? "");

  if (!home || !away) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Teams not set</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use "Edit" to assign the home and away teams before entering a result.
          </p>
          <DialogFooter>
            <Button onClick={onClose}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const homeSquad = players.filter((p: any) => p.team_id === home.id);
  const awaySquad = players.filter((p: any) => p.team_id === away.id);
  const isKO = match.stage !== "group";
  const isTied = hs === as_;
  const needsWinner = status === "finished" && isKO && isTied;
  const fn = useServerFn(adminSaveResult);
  const save = useMutation({
    mutationFn: () => {
      // Ensure first scorer is included in scorers list (client-side mirror of server rule)
      const allScorers =
        firstScorer && !scorers.includes(firstScorer) ? [firstScorer, ...scorers] : scorers;
      return fn({
        data: {
          match_id: match.id,
          home_score: hs,
          away_score: as_,
          status,
          winner_team_id: winner || null,
          first_scorer_player_id: firstScorer || null,
          scorer_player_ids: allScorers.filter((x) => x !== firstScorer),
        },
      });
    },
    onSuccess: () => {
      toast.success("Result saved");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {home.flag_emoji} {home.name} vs {away.name} {away.flag_emoji}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3">
            <NumberBox value={hs} setValue={setHs} label={home.code} />
            <span className="text-xl font-mono text-muted-foreground">–</span>
            <NumberBox value={as_} setValue={setAs} label={away.code} />
          </div>

          <div>
            <Label>Match status</Label>
            <div className="grid grid-cols-3 gap-1 mt-1 p-1 bg-muted rounded-md">
              {(["scheduled", "live", "finished"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors ${
                    status === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {status === "finished" && (
            <div>
              <Label>
                Winner{" "}
                {needsWinner ? (
                  <span className="text-destructive">(required — tied knockout match)</span>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    (optional — auto-derived from score)
                  </span>
                )}
              </Label>
              <select
                value={winner}
                onChange={(e) => setWinner(e.target.value)}
                className={`mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm ${
                  needsWinner && !winner ? "border-destructive" : "border-input"
                }`}
              >
                <option value="">— Auto from score —</option>
                <option value={home.id}>{home.flag_emoji} {home.name}</option>
                <option value={away.id}>{away.flag_emoji} {away.name}</option>
              </select>
            </div>
          )}



          <div>
            <Label>First goalscorer</Label>
            <select
              value={firstScorer}
              onChange={(e) => setFirstScorer(e.target.value)}
              className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="">— None —</option>
              <optgroup label={home.name}>
                {homeSquad.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
              <optgroup label={away.name}>
                {awaySquad.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            </select>
          </div>

          <div>
            <Label>All goalscorers</Label>
            <div className="grid grid-cols-2 gap-3 mt-1 max-h-40 overflow-y-auto">
              {[{ team: home, list: homeSquad }, { team: away, list: awaySquad }].map(({ team, list }) => (
                <div key={team.id}>
                  <div className="text-xs font-semibold mb-1">{team.name}</div>
                  {list.map((p: any) => {
                    const checked = scorers.includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-2 text-xs py-0.5">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            if (v) setScorers([...scorers, p.id]);
                            else setScorers(scorers.filter((x) => x !== p.id));
                          }}
                        />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (needsWinner && !winner)}>

            {save.isPending ? "Saving…" : "Save result"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberBox({ value, setValue, label }: { value: number; setValue: (n: number) => void; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <Input
        type="number"
        min={0}
        max={20}
        value={value}
        onChange={(e) => setValue(Math.max(0, Math.min(20, parseInt(e.target.value || "0", 10))))}
        className="w-16 text-center text-xl font-bold font-mono h-12"
      />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</span>
    </div>
  );
}
