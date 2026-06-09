import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreMatchPrediction,
  scoreGoalscorers,
  scoreTop3,
  scoreTopScorerLeague,
  knockoutPointsForStage,
  predictedWinner,
} from "./scoring";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// ---------- Admin reads ----------

export const adminGetAllMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: matches }, { data: scorers }, { data: cache }] = await Promise.all([
      supabaseAdmin
        .from("matches")
        .select(
          "id,stage,group_letter,bracket_code,home_team_id,away_team_id,home_source_code,away_source_code,kickoff_at,status,home_score,away_score,winner_team_id,finished_at"
        )
        .order("kickoff_at"),
      supabaseAdmin.from("match_goalscorers").select("match_id,player_id,is_first,ord"),
      supabaseAdmin
        .from("leaderboard_cache")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);
    return {
      matches: matches ?? [],
      scorers: scorers ?? [],
      last_recalc_at: cache?.[0]?.updated_at ?? null,
    };
  });

// ---------- Admin: match edit (kickoff / teams) ----------

const EditMatchInput = z.object({
  match_id: z.string().uuid(),
  kickoff_at: z.string().datetime().optional(),
  home_team_id: z.string().uuid().nullable().optional(),
  away_team_id: z.string().uuid().nullable().optional(),
});

export const adminEditMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EditMatchInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      kickoff_at?: string;
      home_team_id?: string | null;
      away_team_id?: string | null;
    } = {};
    if (data.kickoff_at) patch.kickoff_at = data.kickoff_at;
    if (data.home_team_id !== undefined) patch.home_team_id = data.home_team_id;
    if (data.away_team_id !== undefined) patch.away_team_id = data.away_team_id;
    const { error } = await supabaseAdmin.from("matches").update(patch).eq("id", data.match_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Admin: result entry ----------

const ResultInput = z.object({
  match_id: z.string().uuid(),
  home_score: z.number().int().min(0).max(20),
  away_score: z.number().int().min(0).max(20),
  status: z.enum(["scheduled", "live", "finished"]),
  // Required for tied KO matches (penalty winner); optional otherwise.
  winner_team_id: z.string().uuid().nullable().optional(),
  first_scorer_player_id: z.string().uuid().nullable().optional(),
  scorer_player_ids: z.array(z.string().uuid()).max(40).default([]),
});

const KO_STAGES = new Set(["r32", "r16", "qf", "sf", "third", "final"]);

export const adminSaveResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ResultInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Load match for defensive validation
    const { data: match, error: mErr } = await supabaseAdmin
      .from("matches")
      .select("id,stage,home_team_id,away_team_id")
      .eq("id", data.match_id)
      .single();
    if (mErr || !match) throw new Error("Match not found");

    if (data.status === "finished" && (!match.home_team_id || !match.away_team_id)) {
      throw new Error("Cannot save a result before both teams are assigned");
    }

    // Resolve winner_team_id
    let winner_team_id: string | null = null;
    if (data.status === "finished" && match.home_team_id && match.away_team_id) {
      if (data.winner_team_id) {
        if (
          data.winner_team_id !== match.home_team_id &&
          data.winner_team_id !== match.away_team_id
        ) {
          throw new Error("Winner must be the home or away team");
        }
        winner_team_id = data.winner_team_id;
      } else if (data.home_score > data.away_score) {
        winner_team_id = match.home_team_id;
      } else if (data.away_score > data.home_score) {
        winner_team_id = match.away_team_id;
      } else if (KO_STAGES.has(match.stage)) {
        throw new Error(
          "Knockout match is tied — pick the penalty-shootout winner before saving"
        );
      }
      // Group draw → winner_team_id stays null
    }

    // Dedupe and validate scorer squad membership
    const uniqueScorerIds = Array.from(new Set(data.scorer_player_ids));
    if (
      data.first_scorer_player_id &&
      !uniqueScorerIds.includes(data.first_scorer_player_id)
    ) {
      throw new Error("First scorer must also be selected in All goalscorers");
    }
    if (uniqueScorerIds.length > 0 && match.home_team_id && match.away_team_id) {
      const { data: validPlayers, error: pErr } = await supabaseAdmin
        .from("players")
        .select("id")
        .in("id", uniqueScorerIds)
        .in("team_id", [match.home_team_id, match.away_team_id]);
      if (pErr) throw new Error(pErr.message);
      const validIds = new Set((validPlayers ?? []).map((p) => p.id));
      const bad = uniqueScorerIds.filter((id) => !validIds.has(id));
      if (bad.length > 0) {
        throw new Error("Goalscorer(s) do not belong to either team in this match");
      }
    }

    const { error: uErr } = await supabaseAdmin
      .from("matches")
      .update({
        home_score: data.home_score,
        away_score: data.away_score,
        status: data.status,
        winner_team_id,
        finished_at: data.status === "finished" ? new Date().toISOString() : null,
      })
      .eq("id", data.match_id);
    if (uErr) throw new Error(uErr.message);

    // Replace goalscorer rows
    const { error: dErr } = await supabaseAdmin
      .from("match_goalscorers")
      .delete()
      .eq("match_id", data.match_id);
    if (dErr) throw new Error(dErr.message);

    const rows: { match_id: string; player_id: string; is_first: boolean; ord: number }[] = [];
    let ord = 0;
    if (data.first_scorer_player_id) {
      rows.push({
        match_id: data.match_id,
        player_id: data.first_scorer_player_id,
        is_first: true,
        ord: ord++,
      });
    }
    for (const pid of uniqueScorerIds) {
      if (pid === data.first_scorer_player_id) continue;
      rows.push({ match_id: data.match_id, player_id: pid, is_first: false, ord: ord++ });
    }
    if (rows.length > 0) {
      const { error: gErr } = await supabaseAdmin.from("match_goalscorers").insert(rows);
      if (gErr) throw new Error(gErr.message);
    }

    // Auto-recalculate leaderboard so points reflect this save without admin intervention.
    try {
      await runRecalculation(supabaseAdmin);
    } catch (e) {
      console.error("Auto-recalculation failed after save:", e);
      // Don't fail the save — admin can hit "Recalculate" manually.
    }

    return { ok: true };
  });

// ---------- Full recalculation (idempotent) — shared by admin button + auto-run after save ----------

async function runRecalculation(supabaseAdmin: any) {
  const [
    { data: profiles },
    { data: matches },
    { data: predictions },
    { data: predScorers },
    { data: actualScorers },
    { data: top3s },
    { data: tsParents },
    { data: tsPicks },
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select("id"),
    supabaseAdmin
      .from("matches")
      .select(
        "id,stage,status,home_score,away_score,home_team_id,away_team_id,winner_team_id"
      ),
    supabaseAdmin
      .from("predictions")
      .select(
        "id,user_id,match_id,outcome,home_score,away_score,first_scorer_player_id"
      ),
    supabaseAdmin.from("prediction_scorers").select("prediction_id,player_id"),
    supabaseAdmin.from("match_goalscorers").select("match_id,player_id,is_first"),
    supabaseAdmin
      .from("top3_predictions")
      .select("user_id,winner_team_id,runner_up_team_id,third_team_id,submitted_at"),
    supabaseAdmin.from("top_scorer_predictions").select("user_id,submitted_at"),
    supabaseAdmin.from("top_scorer_prediction_picks").select("user_id,rank,player_id"),
  ]);

  const matchById = new Map((matches ?? []).map((m: any) => [m.id, m]));
  const finished = (matches ?? []).filter(
    (m: any) => m.status === "finished" && m.home_score !== null && m.away_score !== null
  );
  const finishedIds = new Set(finished.map((m: any) => m.id));

  const actualByMatch = new Map<string, { first: string | null; all: string[] }>();
  for (const g of actualScorers ?? []) {
    const entry = actualByMatch.get(g.match_id) ?? { first: null, all: [] };
    if (g.is_first) entry.first = g.player_id;
    entry.all.push(g.player_id);
    actualByMatch.set(g.match_id, entry);
  }

  const scorersByPred = new Map<string, string[]>();
  for (const s of predScorers ?? []) {
    const arr = scorersByPred.get(s.prediction_id) ?? [];
    arr.push(s.player_id);
    scorersByPred.set(s.prediction_id, arr);
  }

  const finalMatch = (matches ?? []).find((m: any) => m.stage === "final" && m.status === "finished");
  const thirdMatch = (matches ?? []).find((m: any) => m.stage === "third" && m.status === "finished");
  let actualWinner: string | null = null;
  let actualRunnerUp: string | null = null;
  let actualThird: string | null = null;
  if (finalMatch && finalMatch.winner_team_id) {
    actualWinner = finalMatch.winner_team_id;
    actualRunnerUp =
      finalMatch.home_team_id === actualWinner ? finalMatch.away_team_id : finalMatch.home_team_id;
  }
  if (thirdMatch && thirdMatch.winner_team_id) {
    actualThird = thirdMatch.winner_team_id;
  }

  // ---- Top Scorer League standings (derived from finished match_goalscorers) ----
  const goalsByPlayer = new Map<string, number>();
  for (const g of actualScorers ?? []) {
    if (!finishedIds.has(g.match_id)) continue;
    goalsByPlayer.set(g.player_id, (goalsByPlayer.get(g.player_id) ?? 0) + 1);
  }
  const standings = Array.from(goalsByPlayer.entries())
    .map(([player_id, goals]) => ({ player_id, goals }))
    .sort((a, b) => b.goals - a.goals);
  // Dense ranking with shared ranks for ties (1, 2, 2, 4, ...)
  const actualRankByPlayer = new Map<string, number>();
  let lastGoals = -1;
  let lastRank = 0;
  standings.forEach((s, i) => {
    if (s.goals !== lastGoals) {
      lastRank = i + 1;
      lastGoals = s.goals;
    }
    actualRankByPlayer.set(s.player_id, lastRank);
  });

  const totals = new Map<
    string,
    {
      match_points: number;
      goalscorer_points: number;
      knockout_points: number;
      top3_points: number;
      top_scorer_points: number;
      exact_count: number;
      onextwo_count: number;
      predictions_made: number;
      top3_submitted_at: string | null;
    }
  >();
  for (const p of profiles ?? []) {
    totals.set(p.id, {
      match_points: 0,
      goalscorer_points: 0,
      knockout_points: 0,
      top3_points: 0,
      top_scorer_points: 0,
      exact_count: 0,
      onextwo_count: 0,
      predictions_made: 0,
      top3_submitted_at: null,
    });
  }

  const predPointsUpdates: { id: string; points: number }[] = [];

  for (const pred of predictions ?? []) {
    const acc = totals.get(pred.user_id);
    if (!acc) continue;
    acc.predictions_made += 1;
    const match: any = matchById.get(pred.match_id);
    if (!match) continue;
    if (match.status !== "finished" || match.home_score === null || match.away_score === null) {
      predPointsUpdates.push({ id: pred.id, points: 0 });
      continue;
    }
    const { match_points, exact, correct_1x2 } = scoreMatchPrediction(
      { outcome: pred.outcome, home_score: pred.home_score, away_score: pred.away_score },
      { home_score: match.home_score, away_score: match.away_score }
    );
    const gs = scoreGoalscorers(
      {
        first_scorer_player_id: pred.first_scorer_player_id,
        scorer_ids: scorersByPred.get(pred.id) ?? [],
      },
      {
        first_scorer_player_id: actualByMatch.get(match.id)?.first ?? null,
        scorer_player_ids: actualByMatch.get(match.id)?.all ?? [],
      }
    );

    let ko = 0;
    if (match.stage !== "group" && match.stage !== "third" && match.winner_team_id) {
      const predTeam = predictedWinner(pred, match);
      if (predTeam && predTeam === match.winner_team_id) {
        ko = knockoutPointsForStage(match.stage);
      }
    }

    acc.match_points += match_points;
    acc.goalscorer_points += gs;
    acc.knockout_points += ko;
    if (exact) acc.exact_count += 1;
    if (correct_1x2) acc.onextwo_count += 1;

    predPointsUpdates.push({ id: pred.id, points: match_points + gs + ko });
  }

  const top3PointsUpdates: { user_id: string; points: number }[] = [];
  for (const t of top3s ?? []) {
    const acc = totals.get(t.user_id);
    if (!acc) continue;
    acc.top3_submitted_at = t.submitted_at;
    const pts = scoreTop3(
      {
        winner_team_id: t.winner_team_id,
        runner_up_team_id: t.runner_up_team_id,
        third_team_id: t.third_team_id,
      },
      { winner_team_id: actualWinner, runner_up_team_id: actualRunnerUp, third_team_id: actualThird }
    );
    acc.top3_points += pts;
    top3PointsUpdates.push({ user_id: t.user_id, points: pts });
  }

  // ---- Top Scorer League per-user scoring ----
  const picksByUser = new Map<string, (string | null)[]>();
  for (const pk of tsPicks ?? []) {
    const arr = picksByUser.get(pk.user_id) ?? new Array(10).fill(null);
    if (pk.rank >= 1 && pk.rank <= 10) arr[pk.rank - 1] = pk.player_id;
    picksByUser.set(pk.user_id, arr);
  }
  const tsPointsUpdates: { user_id: string; points: number }[] = [];
  for (const parent of tsParents ?? []) {
    const acc = totals.get(parent.user_id);
    if (!acc) continue;
    const predicted = picksByUser.get(parent.user_id) ?? [];
    const pts = scoreTopScorerLeague(predicted, actualRankByPlayer);
    acc.top_scorer_points += pts;
    tsPointsUpdates.push({ user_id: parent.user_id, points: pts });
  }

  for (const u of predPointsUpdates) {
    await supabaseAdmin.from("predictions").update({ points: u.points }).eq("id", u.id);
  }
  for (const u of top3PointsUpdates) {
    await supabaseAdmin.from("top3_predictions").update({ points: u.points }).eq("user_id", u.user_id);
  }
  for (const u of tsPointsUpdates) {
    await supabaseAdmin.from("top_scorer_predictions").update({ points: u.points }).eq("user_id", u.user_id);
  }

  const rows = [...totals.entries()].map(([user_id, v]) => ({
    user_id,
    total:
      v.match_points + v.goalscorer_points + v.knockout_points + v.top3_points + v.top_scorer_points,
    match_points: v.match_points,
    goalscorer_points: v.goalscorer_points,
    knockout_points: v.knockout_points,
    top3_points: v.top3_points,
    top_scorer_points: v.top_scorer_points,
    exact_count: v.exact_count,
    onextwo_count: v.onextwo_count,
    predictions_made: v.predictions_made,
    top3_submitted_at: v.top3_submitted_at,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error: upErr } = await supabaseAdmin
      .from("leaderboard_cache")
      .upsert(rows, { onConflict: "user_id" });
    if (upErr) throw new Error(`Leaderboard upsert failed: ${upErr.message}`);
  }
  const keepIds = rows.map((r) => r.user_id);
  if (keepIds.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("leaderboard_cache")
      .delete()
      .not("user_id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);
    if (delErr) throw new Error(`Leaderboard cleanup failed: ${delErr.message}`);
  }

  return { ok: true, users: rows.length, finished_matches: finished.length };
}

export const adminRecalculate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runRecalculation(supabaseAdmin);
  });


// ---------- Cached leaderboard read with tie-breakers ----------

export const getCachedLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: cache }, { data: profiles }] = await Promise.all([
      supabase.from("leaderboard_cache").select("*"),
      supabase.from("profiles").select("id,name,department,avatar_url"),
    ]);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const rows = (cache ?? []).map((c: any) => ({
      ...c,
      name: pMap.get(c.user_id)?.name ?? "Unknown",
      department: pMap.get(c.user_id)?.department ?? null,
      avatar_url: pMap.get(c.user_id)?.avatar_url ?? null,
    }));
    rows.sort((a: any, b: any) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.exact_count !== a.exact_count) return b.exact_count - a.exact_count;
      if (b.onextwo_count !== a.onextwo_count) return b.onextwo_count - a.onextwo_count;
      if (b.goalscorer_points !== a.goalscorer_points)
        return b.goalscorer_points - a.goalscorer_points;
      const at = a.top3_submitted_at ? new Date(a.top3_submitted_at).getTime() : Infinity;
      const bt = b.top3_submitted_at ? new Date(b.top3_submitted_at).getTime() : Infinity;
      return at - bt;
    });
    return rows;
  });

// ---------- CSV export ----------

export const adminExportLeaderboardCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: cache }, { data: profiles }, { data: users }] = await Promise.all([
      supabaseAdmin.from("leaderboard_cache").select("*"),
      supabaseAdmin.from("profiles").select("id,name,department"),
      supabaseAdmin.auth.admin.listUsers(),
    ]);
    const emailMap = new Map<string, string>();
    for (const u of users?.users ?? []) emailMap.set(u.id, u.email ?? "");
    const pMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const rows = (cache ?? []).map((c: any) => ({
      ...c,
      name: pMap.get(c.user_id)?.name ?? "",
      department: pMap.get(c.user_id)?.department ?? "",
      email: emailMap.get(c.user_id) ?? "",
    }));
    // Same tie-breakers as getCachedLeaderboard
    rows.sort((a: any, b: any) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.exact_count !== a.exact_count) return b.exact_count - a.exact_count;
      if (b.onextwo_count !== a.onextwo_count) return b.onextwo_count - a.onextwo_count;
      if (b.goalscorer_points !== a.goalscorer_points)
        return b.goalscorer_points - a.goalscorer_points;
      const at = a.top3_submitted_at ? new Date(a.top3_submitted_at).getTime() : Infinity;
      const bt = b.top3_submitted_at ? new Date(b.top3_submitted_at).getTime() : Infinity;
      return at - bt;
    });

    const header = [
      "Rank",
      "Name",
      "Email",
      "Department",
      "Total points",
      "Match points",
      "Goalscorer points",
      "Knockout points",
      "Top 3 points",
      "Top scorer points",
      "Exact scores",
      "Correct 1X2",
    ];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    rows.forEach((r: any, i: number) => {
      lines.push(
        [
          i + 1,
          r.name,
          r.email,
          r.department,
          r.total,
          r.match_points,
          r.goalscorer_points,
          r.knockout_points,
          r.top3_points,
          r.top_scorer_points ?? 0,
          r.exact_count,
          r.onextwo_count,
        ]
          .map(esc)
          .join(",")
      );
    });
    return { csv: lines.join("\n"), filename: `leaderboard-${new Date().toISOString().slice(0, 10)}.csv` };
  });

// ---------- Admin: Squad management ----------

export const adminGetAllPlayers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("players")
      .select("id,team_id,name,name_on_shirt,position,shirt_number,club,active")
      .order("team_id")
      .order("shirt_number", { ascending: true, nullsFirst: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const PlayerUpsertInput = z.object({
  id: z.string().uuid().optional(),
  team_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  name_on_shirt: z.string().trim().max(40).nullable().optional(),
  position: z.string().trim().max(20).nullable().optional(),
  shirt_number: z.number().int().min(1).max(99).nullable().optional(),
  club: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().default(true),
});

export const adminUpsertPlayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PlayerUpsertInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      team_id: data.team_id,
      name: data.name,
      name_on_shirt: data.name_on_shirt ?? null,
      position: data.position ?? null,
      shirt_number: data.shirt_number ?? null,
      club: data.club ?? null,
      active: data.active,
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("players").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await supabaseAdmin
      .from("players")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const adminSetPlayerActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("players")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// CSV columns: team_code,name,name_on_shirt,position,shirt_number,club,active
const CSV_HEADERS = ["team_code", "name", "name_on_shirt", "position", "shirt_number", "club", "active"];

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ""; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); field = "";
        if (cur.some((v) => v !== "")) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.some((v) => v !== "")) rows.push(cur); }
  return rows;
}

export const adminImportPlayersCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      csv: z.string().min(1).max(2_000_000),
      mode: z.enum(["replace_team", "upsert"]).default("upsert"),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rows = parseCSV(data.csv);
    if (rows.length < 2) throw new Error("CSV is empty");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (k: string) => header.indexOf(k);
    for (const h of ["team_code", "name"]) {
      if (idx(h) === -1) throw new Error(`Missing required column: ${h}`);
    }

    const { data: teams, error: tErr } = await supabaseAdmin.from("teams").select("id,code");
    if (tErr) throw new Error(tErr.message);
    const teamByCode = new Map((teams ?? []).map((t) => [t.code.toUpperCase(), t.id]));

    type Row = {
      team_id: string; team_code: string;
      name: string; name_on_shirt: string | null;
      position: string | null; shirt_number: number | null;
      club: string | null; active: boolean;
    };
    const parsed: Row[] = [];
    const errors: string[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const code = (cols[idx("team_code")] || "").trim().toUpperCase();
      const name = (cols[idx("name")] || "").trim();
      if (!code || !name) continue;
      const team_id = teamByCode.get(code);
      if (!team_id) { errors.push(`Row ${r + 1}: unknown team_code "${code}"`); continue; }
      const shirtRaw = idx("shirt_number") >= 0 ? (cols[idx("shirt_number")] || "").trim() : "";
      const shirt_number = shirtRaw ? Number(shirtRaw) : null;
      if (shirt_number !== null && (!Number.isInteger(shirt_number) || shirt_number < 1 || shirt_number > 99)) {
        errors.push(`Row ${r + 1}: invalid shirt_number "${shirtRaw}"`); continue;
      }
      const activeRaw = idx("active") >= 0 ? (cols[idx("active")] || "true").trim().toLowerCase() : "true";
      parsed.push({
        team_id, team_code: code, name,
        name_on_shirt: idx("name_on_shirt") >= 0 ? (cols[idx("name_on_shirt")] || "").trim() || null : null,
        position: idx("position") >= 0 ? (cols[idx("position")] || "").trim() || null : null,
        shirt_number,
        club: idx("club") >= 0 ? (cols[idx("club")] || "").trim() || null : null,
        active: !["false", "0", "no", "inactive"].includes(activeRaw),
      });
    }

    if (errors.length) throw new Error(errors.slice(0, 10).join("; "));
    if (parsed.length === 0) throw new Error("No valid rows found");

    // Duplicate shirt-number check inside CSV per team
    const seen = new Map<string, Set<number>>();
    for (const p of parsed) {
      if (!p.active || p.shirt_number == null) continue;
      const set = seen.get(p.team_id) ?? new Set<number>();
      if (set.has(p.shirt_number)) {
        throw new Error(`Duplicate active shirt #${p.shirt_number} for team ${p.team_code} in CSV`);
      }
      set.add(p.shirt_number);
      seen.set(p.team_id, set);
    }

    let deactivated = 0;
    if (data.mode === "replace_team") {
      const teamIds = Array.from(new Set(parsed.map((p) => p.team_id)));
      // Soft replace: deactivate existing rows for these teams to preserve FKs from predictions
      const { data: del, error: dErr } = await supabaseAdmin
        .from("players")
        .update({ active: false })
        .in("team_id", teamIds)
        .eq("active", true)
        .select("id");
      if (dErr) throw new Error(`Deactivate failed: ${dErr.message}`);
      deactivated = del?.length ?? 0;
    }

    const insertRows = parsed.map((p) => ({
      team_id: p.team_id,
      name: p.name,
      name_on_shirt: p.name_on_shirt,
      position: p.position,
      shirt_number: p.shirt_number,
      club: p.club,
      active: p.active,
    }));
    const { error: insErr } = await supabaseAdmin.from("players").insert(insertRows);
    if (insErr) throw new Error(`Insert failed: ${insErr.message}`);

    return { ok: true, inserted: insertRows.length, deactivated };
  });

export const adminExportPlayersCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: players }, { data: teams }] = await Promise.all([
      supabaseAdmin
        .from("players")
        .select("team_id,name,name_on_shirt,position,shirt_number,club,active")
        .order("team_id")
        .order("shirt_number", { ascending: true, nullsFirst: false }),
      supabaseAdmin.from("teams").select("id,code"),
    ]);
    const codeMap = new Map((teams ?? []).map((t) => [t.id, t.code]));
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [CSV_HEADERS.join(",")];
    for (const p of players ?? []) {
      lines.push([
        codeMap.get(p.team_id) ?? "",
        p.name,
        p.name_on_shirt ?? "",
        p.position ?? "",
        p.shirt_number ?? "",
        p.club ?? "",
        p.active ? "true" : "false",
      ].map(esc).join(","));
    }
    return { csv: lines.join("\n"), filename: `squads-${new Date().toISOString().slice(0, 10)}.csv` };
  });
