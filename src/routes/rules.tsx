import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Trophy, ArrowLeft, Lock, Clock, Flag, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Rules & Scoring — WC 2026 Predictor" },
      { name: "description", content: "How the company World Cup 2026 prediction competition works." },
    ],
  }),
  component: Rules,
});

const basics = [
  { icon: ShieldCheck, title: "How to register", body: "Sign up with your work email, name, and department. You're in immediately — no approval step." },
  { icon: Clock,       title: "Submitting predictions", body: "For every match, pick the outcome (1 / X / 2), the exact final score, the first goalscorer, and any other scorers. You can edit your pick any time before kickoff." },
  { icon: Lock,        title: "Lock time", body: "Predictions lock automatically at kickoff. After that your pick is read-only — no edits, no excuses." },
  { icon: Flag,        title: "Top 3 prediction", body: "Pick the champion, the silver medalist, and the bronze medalist. This must be submitted before the first knockout match kicks off." },
];

// Mirrors src/lib/scoring.ts exactly.
const matchScoring: [string, string][] = [
  ["Correct 1 / X / 2 outcome", "3 pts"],
  ["Exact final score (instead of the 1X2 bonus)", "+5 pts"],
  ["Correct goal difference (not exact, not 0–0 cases)", "+2 pts"],
  ["Correct total goals (and not the above)", "+1 pt"],
];

const goalScoring: [string, string][] = [
  ["Correct first goalscorer", "4 pts"],
  ["Each other correct goalscorer (player appears in scorers)", "2 pts"],
  ["Maximum goalscorer points per match", "8 pts"],
];

const knockoutScoring: [string, string][] = [
  ["Picked the correct team to advance — R32, R16 or QF", "3 pts"],
  ["Picked the correct finalist (SF winner)", "8 pts"],
  ["Picked the correct World Cup winner (Final)", "15 pts"],
];

const top3Scoring: [string, string][] = [
  ["Correct champion", "20 pts"],
  ["Correct silver medalist", "15 pts"],
  ["Correct bronze medalist", "10 pts"],
  ["Right team in the wrong podium slot", "5 pts"],
];

const tieBreakers = [
  "Highest total points",
  "Most exact-score predictions",
  "Most correct 1 / X / 2 outcomes",
  "Most goalscorer points",
  "Earliest submitted Top 3 prediction",
];

function Rules() {
  return (
    <div className="min-h-screen bg-background">
      <header className="text-primary-foreground" style={{ background: "var(--gradient-hero)" }}>
        <div className="container mx-auto px-4 py-12 md:py-20">
          <Link to="/" className="inline-flex items-center text-sm text-primary-foreground/85 hover:text-primary-foreground mb-6">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-primary-foreground/15 backdrop-blur">
              <Trophy className="h-6 w-6" />
            </div>
            <span className="text-sm uppercase tracking-wider font-medium text-primary-foreground/80">Competition</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Rules & Scoring</h1>
          <p className="mt-3 text-primary-foreground/85 text-lg max-w-2xl">
            Everything you need to know about how points are awarded and how ties on the leaderboard are decided.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-4xl space-y-12">
        <section>
          <h2 className="text-2xl font-bold mb-6">The basics</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {basics.map(({ icon: Icon, title, body }) => (
              <Card key={title} className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">{title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <ScoringBlock title="Match prediction points" rows={matchScoring} />
        <ScoringBlock title="Goalscorer points" rows={goalScoring} />
        <ScoringBlock title="Knockout winner bonus" rows={knockoutScoring} />
        <ScoringBlock title="Top 3 points" rows={top3Scoring} />

        <section>
          <h2 className="text-2xl font-bold mb-6">Tie-breakers</h2>
          <Card className="p-6">
            <ol className="space-y-3">
              {tieBreakers.map((tb, i) => (
                <li key={tb} className="flex items-start gap-3">
                  <span className="flex-none grid place-items-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    {i + 1}
                  </span>
                  <span className="text-sm pt-0.5">{tb}</span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </main>
    </div>
  );
}

function ScoringBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section>
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      <Card className="divide-y divide-border overflow-hidden">
        {rows.map(([what, pts]) => (
          <div key={what} className="flex items-center justify-between px-6 py-3.5 gap-4">
            <span className="text-sm">{what}</span>
            <span className="font-mono font-semibold text-primary whitespace-nowrap">{pts}</span>
          </div>
        ))}
      </Card>
    </section>
  );
}
