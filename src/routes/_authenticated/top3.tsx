import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getTeams, getMyTop3, upsertTop3, getMatches } from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trophy, Medal, Award, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/top3")({
  head: () => ({ meta: [{ title: "Top 3 — WC 2026 Predictor" }] }),
  component: Top3Page,
});

function Top3Page() {
  const tFn = useServerFn(getTeams);
  const mFn = useServerFn(getMatches);
  const myFn = useServerFn(getMyTop3);
  const saveFn = useServerFn(upsertTop3);

  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => tFn() });
  const { data: matches = [] } = useQuery({ queryKey: ["matches"], queryFn: () => mFn() });
  const { data: existing } = useQuery({ queryKey: ["myTop3"], queryFn: () => myFn() });

  const [winner, setWinner] = useState("");
  const [runner, setRunner] = useState("");
  const [third, setThird] = useState("");

  useEffect(() => {
    if (existing) {
      setWinner(existing.winner_team_id);
      setRunner(existing.runner_up_team_id);
      setThird(existing.third_team_id);
    }
  }, [existing]);

  const firstKO = matches.find((m) => m.stage !== "group");
  const locked = !!firstKO && new Date(firstKO.kickoff_at) <= new Date();

  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: { winner_team_id: winner, runner_up_team_id: runner, third_team_id: third },
      }),
    onSuccess: () => {
      toast.success("Top 3 saved");
      qc.invalidateQueries({ queryKey: ["myTop3"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Top 3 prediction</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick the champion, runner-up, and third place. Locks at the first knockout kickoff.
        </p>
      </header>

      {locked && (
        <Card className="p-4 flex items-center gap-3 border-destructive/30 bg-destructive/5">
          <Lock className="h-4 w-4 text-destructive" />
          <span className="text-sm">Top 3 predictions are locked — the knockout stage has started.</span>
        </Card>
      )}

      <Card className="p-6 space-y-5">
        <PodiumPick
          icon={<Trophy className="h-5 w-5 text-primary" />}
          title="🥇 World Cup winner"
          points="20 pts"
          value={winner}
          onChange={setWinner}
          teams={teams}
          exclude={[runner, third]}
          disabled={locked}
        />
        <PodiumPick
          icon={<Medal className="h-5 w-5" />}
          title="🥈 Runner-up"
          points="15 pts"
          value={runner}
          onChange={setRunner}
          teams={teams}
          exclude={[winner, third]}
          disabled={locked}
        />
        <PodiumPick
          icon={<Award className="h-5 w-5" />}
          title="🥉 Third place"
          points="10 pts"
          value={third}
          onChange={setThird}
          teams={teams}
          exclude={[winner, runner]}
          disabled={locked}
        />

        <Button
          onClick={() => save.mutate()}
          disabled={locked || !winner || !runner || !third || save.isPending}
          className="w-full"
        >
          {locked ? "Locked" : save.isPending ? "Saving…" : existing ? "Update Top 3" : "Submit Top 3"}
        </Button>

        {existing && (
          <p className="text-xs text-center text-muted-foreground">
            Earned so far: <span className="font-semibold text-primary">{existing.points} pts</span>
          </p>
        )}
      </Card>
    </div>
  );
}

function PodiumPick({
  icon, title, points, value, onChange, teams, exclude, disabled,
}: {
  icon: React.ReactNode; title: string; points: string;
  value: string; onChange: (v: string) => void;
  teams: { id: string; name: string; flag_emoji: string | null }[];
  exclude: string[]; disabled: boolean;
}) {
  return (
    <div>
      <Label className="flex items-center gap-2 mb-2">
        {icon}
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground font-normal">· {points}</span>
      </Label>
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-60"
      >
        <option value="">Select team…</option>
        {teams.filter((t) => !exclude.includes(t.id)).map((t) => (
          <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>
        ))}
      </select>
    </div>
  );
}
