import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreMatchPrediction,
  scoreGoalscorers,
  scoreTop3,
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
    const [{ data: matches }, { data: scorers }] = await Promise.all([
      supabaseAdmin
        .from("matches")
        .select(
          "id,stage,group_letter,bracket_code,home_team_id,away_team_id,home_source_code,away_source_code,kickoff_at,status,home_score,away_score,winner_team_id,finished_at"
        )
        .order("kickoff_at"),
      supabaseAdmin.from("match_goalscorers").select("match_id,player_id,is_first,ord"),
    ]);
    return { matches: matches ?? [], scorers: scorers ?? [] };
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
    const patch: Record<string, unknown> = {};
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
  first_scorer_player_id: z.string().uuid().nullable().optional(),
  scorer_player_ids: z.array(z.string().uuid()).max(40).default([]),
});

export const adminSaveResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ResultInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: uErr } = await supabaseAdmin
      .from("matches")
      .update({
        home_score: data.home_score,
        away_score: data.away_score,
        status: data.status,
        finished_at: data.status === "finished" ? new Date().toISOString() : null,
      })
      .eq("id", data.match_id);
    if (uErr) throw new Error(uErr.message);

    // Replace goalscorer rows
    await supabaseAdmin.from("match_goalscorers").delete().eq("match_id", data.match_id);
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
    for (const pid of data.scorer_player_ids) {
      if (pid === data.first_scorer_player_id) continue;
      rows.push({ match_id: data.match_id, player_id: pid, is_first: false, ord: ord++ });
    }
    if (rows.length > 0) {
      const { error: gErr } = await supabaseAdmin.from("match_goalscorers").insert(rows);
      if (gErr) throw new Error(gErr.message);
    }

    return { ok: true };
  });

// ---------- Admin: full recalculation (idempotent) ----------

export const adminRecalculate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: profiles },
      { data: matches },
      { data: predictions },
      { data: predScorers },
      { data: actualScorers },
      { data: top3s },
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
        .select(
          "user_id,winner_team_id,runner_up_team_id,third_team_id,submitted_at"
        ),
    ]);

    const matchById = new Map((matches ?? []).map((m) => [m.id, m]));
    const finished = (matches ?? []).filter((m) => m.status === "finished" && m.home_score !== null && m.away_score !== null);

    // Build actual scorers per match
    const actualByMatch = new Map<string, { first: string | null; all: string[] }>();
    for (const g of actualScorers ?? []) {
      const entry = actualByMatch.get(g.match_id) ?? { first: null, all: [] };
      if (g.is_first) entry.first = g.player_id;
      entry.all.push(g.player_id);
      actualByMatch.set(g.match_id, entry);
    }

    // Predicted scorers per prediction
    const scorersByPred = new Map<string, string[]>();
    for (const s of predScorers ?? []) {
      const arr = scorersByPred.get(s.prediction_id) ?? [];
      arr.push(s.player_id);
      scorersByPred.set(s.prediction_id, arr);
    }

    // Final standings for Top 3
    const finalMatch = (matches ?? []).find((m) => m.stage === "final" && m.status === "finished");
    const thirdMatch = (matches ?? []).find((m) => m.stage === "third" && m.status === "finished");
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

    // Per-user totals
    const totals = new Map<
      string,
      {
        match_points: number;
        goalscorer_points: number;
        knockout_points: number;
        top3_points: number;
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
        exact_count: 0,
        onextwo_count: 0,
        predictions_made: 0,
        top3_submitted_at: null,
      });
    }

    // Per-prediction updates (write back points column)
    const predPointsUpdates: { id: string; points: number }[] = [];

    for (const pred of predictions ?? []) {
      const acc = totals.get(pred.user_id);
      if (!acc) continue;
      acc.predictions_made += 1;
      const match = matchById.get(pred.match_id);
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

    // Top 3 scoring
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

    // Persist per-prediction points (batched updates)
    for (const u of predPointsUpdates) {
      await supabaseAdmin.from("predictions").update({ points: u.points }).eq("id", u.id);
    }
    for (const u of top3PointsUpdates) {
      await supabaseAdmin.from("top3_predictions").update({ points: u.points }).eq("user_id", u.user_id);
    }

    // Rebuild leaderboard_cache fully (idempotent)
    await supabaseAdmin.from("leaderboard_cache").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
    const rows = [...totals.entries()].map(([user_id, v]) => ({
      user_id,
      total: v.match_points + v.goalscorer_points + v.knockout_points + v.top3_points,
      match_points: v.match_points,
      goalscorer_points: v.goalscorer_points,
      knockout_points: v.knockout_points,
      top3_points: v.top3_points,
      exact_count: v.exact_count,
      onextwo_count: v.onextwo_count,
      predictions_made: v.predictions_made,
      top3_submitted_at: v.top3_submitted_at,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("leaderboard_cache").insert(rows);
      if (error) throw new Error(error.message);
    }

    return { ok: true, users: rows.length, finished_matches: finished.length };
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
    rows.sort((a: any, b: any) => b.total - a.total);

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
          r.exact_count,
          r.onextwo_count,
        ]
          .map(esc)
          .join(",")
      );
    });
    return { csv: lines.join("\n"), filename: `leaderboard-${new Date().toISOString().slice(0, 10)}.csv` };
  });
