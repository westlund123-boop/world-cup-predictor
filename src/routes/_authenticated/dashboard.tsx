import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, lazy, Suspense } from "react";
import {
  getMatches, getTeams, getMyPredictions, getLeaderboard, getMyProfile,
  getWallMessages, postWallMessage, deleteWallMessage,
} from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TeamFlag } from "@/components/TeamFlag";
import { matchStatus, STAGE_LABEL } from "@/lib/scoring";
import { Trophy, Target, TrendingUp, Calendar, ArrowRight, MessageSquare, Trash2, Send, Sparkles, Smile, Flag } from "lucide-react";
import { toast } from "sonner";
import aumovioLogo from "@/assets/aumovio-logo.svg.asset.json";
import { NewsPanel } from "@/components/NewsPanel";

// Lazy so the ~200kb emoji bundle never blocks initial dashboard render.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

const QUICK_FLAGS = [
  "🇸🇪","🇳🇴","🇩🇰","🇫🇮","🇩🇪","🇪🇸","🇫🇷","🇮🇹","🇬🇧","🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "🇧🇷","🇦🇷","🇵🇹","🇳🇱","🇧🇪","🇭🇷","🇺🇸","🇲🇽","🇯🇵","🇰🇷",
];

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
        className="relative overflow-hidden rounded-2xl text-primary-foreground"
        style={{ background: "var(--gradient-hero)" }}
      >
        {/* Playful floating emoji confetti */}
        <div aria-hidden className="pointer-events-none absolute inset-0 select-none text-3xl md:text-4xl opacity-25">
          <span className="absolute top-6 right-[18%] animate-bounce" style={{ animationDuration: "3s" }}>⚽</span>
          <span className="absolute top-20 right-[8%] animate-pulse">🏆</span>
          <span className="absolute bottom-6 right-[28%] animate-bounce" style={{ animationDuration: "4s", animationDelay: "0.5s" }}>🎉</span>
          <span className="absolute bottom-12 right-[12%] animate-pulse" style={{ animationDelay: "1s" }}>🥅</span>
          <span className="absolute top-1/2 right-[40%] animate-bounce" style={{ animationDuration: "5s" }}>🎯</span>
        </div>

        {/* Top brand bar */}
        <div className="relative flex items-center justify-between gap-4 px-6 md:px-10 pt-5">
          <div className="inline-flex items-center gap-2 text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-primary-foreground/90 font-semibold bg-primary-foreground/10 backdrop-blur px-3 py-1.5 rounded-full">
            <Sparkles className="h-3 w-3" /> World Cup Betting for Aumovio AB
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-primary-foreground/70 font-medium">
            <span className="hidden sm:inline">presented by</span>
            <img
              src={aumovioLogo.url}
              alt="Aumovio AB"
              className="h-5 md:h-6 w-auto rounded-sm"
            />
          </div>
        </div>

        {/* Hero greeting */}
        <div className="relative px-6 md:px-10 pt-6 pb-8 md:pb-10">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            Hej {me?.profile?.name?.split(" ")[0] ?? "spelare"}!{" "}
            <span className="inline-block animate-wave origin-[70%_70%]">👋</span>
          </h1>
          <p className="text-primary-foreground/90 mt-2 text-base md:text-lg max-w-xl">
            {openWithoutPred > 0
              ? `Du har ${openWithoutPred} öppen match${openWithoutPred === 1 ? "" : "er"} kvar att tippa. Lycka till! 🍀`
              : "Allt tippat — luta dig tillbaka och håll tummarna. 🤞"}
          </p>
        </div>
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
                const home = m.home_team_id ? teamMap.get(m.home_team_id) : undefined;
                const away = m.away_team_id ? teamMap.get(m.away_team_id) : undefined;
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
                          <TeamFlag code={home?.code} name={home?.name} size="lg" />
                        </div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">vs</div>
                        <div className="flex items-center gap-2 justify-start">
                          <TeamFlag code={away?.code} name={away?.name} size="lg" />
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

          <div className="pt-2">
            <WallSection meId={me?.profile?.id} isAdmin={me?.isAdmin ?? false} />
          </div>
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

          <NewsPanel />
        </div>
      </section>
    </div>
  );
}

function WallSection({ meId, isAdmin }: { meId?: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(getWallMessages);
  const postFn = useServerFn(postWallMessage);
  const delFn = useServerFn(deleteWallMessage);
  const [body, setBody] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["wall"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });

  const post = useMutation({
    mutationFn: (text: string) => postFn({ data: { body: text } }),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["wall"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wall"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const text = body.trim();
  const tooLong = text.length > 500;

  function insertAtCursor(insert: string) {
    const ta = taRef.current;
    if (!ta) {
      setBody((b) => (b + insert).slice(0, 500));
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = (body.slice(0, start) + insert + body.slice(end)).slice(0, 500);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = Math.min(start + insert.length, next.length);
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Klotterplank</h2>
        <span className="text-xs text-muted-foreground">— prata med dina medspelare</span>
      </div>

      <Card className="p-4 space-y-3">
        <Textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Skriv något smart, smutskasta en rival eller hyll en favorit… 🎉"
          rows={2}
          maxLength={500}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-primary" aria-label="Add emoji">
                  <Smile className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0 w-auto border-none shadow-xl">
                <Suspense fallback={<div className="p-6 text-xs text-muted-foreground">Laddar…</div>}>
                  <EmojiPicker
                    onEmojiClick={(e) => insertAtCursor(e.emoji)}
                    width={320}
                    height={380}
                    searchPlaceholder="Sök emoji…"
                    previewConfig={{ showPreview: false }}
                  />
                </Suspense>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-primary" aria-label="Add flag">
                  <Flag className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-2 w-64">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 px-1">
                  Snabbflaggor
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {QUICK_FLAGS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => insertAtCursor(f)}
                      className="text-xl h-8 w-8 grid place-items-center rounded hover:bg-muted transition-colors"
                      aria-label={`Insert ${f}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <span className={`text-xs ml-2 ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
              {text.length}/500
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => post.mutate(text)}
            disabled={post.isPending || text.length === 0 || tooLong}
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {post.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      </Card>

      <Card className="divide-y divide-border overflow-hidden">
        {messages.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No messages yet. Be the first to scribble on the wall.
          </div>
        ) : (
          messages.map((m: any) => {
            const canDelete = isAdmin || m.author_id === meId;
            return (
              <div key={m.id} className="p-4 flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-muted shrink-0 flex items-center justify-center text-xs font-semibold text-muted-foreground overflow-hidden">
                  {m.author_avatar
                    ? <img src={m.author_avatar} alt="" className="h-full w-full object-cover" />
                    : (m.author_name?.[0]?.toUpperCase() ?? "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.author_name}</span>
                    <span>·</span>
                    <time dateTime={m.created_at}>
                      {new Date(m.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                </div>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => del.mutate(m.id)}
                    disabled={del.isPending}
                    aria-label="Delete message"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </Card>
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
