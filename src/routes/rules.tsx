import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Trophy, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Rules & Scoring — WC 2026 Predictor" },
      { name: "description", content: "How the company World Cup 2026 prediction competition works." },
    ],
  }),
  component: Rules,
});

const sections = [
  {
    title: "How to register",
    body: "Create an account with your work email, name, and department. You're in.",
  },
  {
    title: "Submitting predictions",
    body: "For every match, pick the outcome (1 / X / 2), the exact final score, and the goalscorers you think will hit the net. You can edit your pick any time before kickoff.",
  },
  {
    title: "Lock time",
    body: "Predictions lock automatically at kickoff. After that, your pick is read-only — no edits, no excuses.",
  },
  {
    title: "Top 3 prediction",
    body: "Pick the champion, the silver medalist, and the bronze medalist. This must be submitted before the first knockout match starts.",
  },
];

const scoring = [
  ["Correct 1 / X / 2 outcome", "3 pts"],
  ["Exact final score", "+5 bonus"],
  ["Correct goal difference (not exact)", "+2 bonus"],
  ["Correct total goals (not exact)", "+1 bonus"],
  ["Each correct goalscorer", "2 pts"],
  ["Correct first goalscorer", "4 pts"],
  ["Max goalscorer points per match", "8 pts"],
  ["Correct team advancing in knockout", "3 pts"],
  ["Correct finalist", "8 pts"],
  ["Correct World Cup winner", "15 pts"],
  ["Correct champion (Top 3)", "20 pts"],
  ["Correct silver medalist", "15 pts"],
  ["Correct bronze medalist", "10 pts"],
  ["Right team, wrong podium position", "5 pts"],
];

const tieBreakers = [
  "Most exact scores",
  "Most correct 1 / X / 2 predictions",
  "Most goalscorer points",
  "Earliest submitted Top 3 prediction",
];

function Rules() {
  return (
    <div className="min-h-screen bg-background">
      <header
        className="text-primary-foreground"
        style={{ background: "var(--gradient-hero)" }}
      >
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
            Everything you need to know about how points are awarded and how the leaderboard is decided.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-4xl space-y-12">
        <section>
          <h2 className="text-2xl font-bold mb-6">The basics</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {sections.map((s) => (
              <Card key={s.title} className="p-6">
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-6">Scoring</h2>
          <Card className="divide-y divide-border overflow-hidden">
            {scoring.map(([what, pts]) => (
              <div key={what} className="flex items-center justify-between px-6 py-3.5">
                <span className="text-sm">{what}</span>
                <span className="font-mono font-semibold text-primary">{pts}</span>
              </div>
            ))}
          </Card>
        </section>

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
