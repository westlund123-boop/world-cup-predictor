import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Public reads ----------

export const getTeams = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("id,name,code,flag_emoji,group_letter")
    .order("group_letter")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getMatches = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select(
      "id,stage,group_letter,kickoff_at,status,home_score,away_score,home_team_id,away_team_id,bracket_code,home_source_code,away_source_code,winner_team_id"
    )
    .order("kickoff_at");
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getPlayers = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id,team_id,name,name_on_shirt,position,shirt_number,club,active")
    .eq("active", true)
    .order("shirt_number", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
});

// ---------- Authenticated reads ----------

export const getMyPredictions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: preds, error } = await supabase
      .from("predictions")
      .select("id,match_id,outcome,home_score,away_score,first_scorer_player_id,points")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const { data: scorers } = await supabase
      .from("prediction_scorers")
      .select("prediction_id,player_id");

    return { predictions: preds ?? [], scorers: scorers ?? [] };
  });

export const getMyTop3 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("top3_predictions")
      .select("winner_team_id,runner_up_team_id,third_team_id,points,submitted_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id,name,department,avatar_url").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    return {
      profile,
      isAdmin: (roles ?? []).some((r) => r.role === "admin"),
    };
  });

export const getLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: profiles }, { data: preds }, { data: top3 }] = await Promise.all([
      supabase.from("profiles").select("id,name,department,avatar_url"),
      supabase.from("predictions").select("user_id,points,outcome,home_score,away_score,match_id"),
      supabase.from("top3_predictions").select("user_id,points,submitted_at"),
    ]);

    const rows = (profiles ?? []).map((p) => {
      const mine = (preds ?? []).filter((x) => x.user_id === p.id);
      const matchPts = mine.reduce((s, x) => s + (x.points ?? 0), 0);
      const top3row = (top3 ?? []).find((t) => t.user_id === p.id);
      return {
        user_id: p.id,
        name: p.name,
        department: p.department,
        avatar_url: p.avatar_url,
        match_points: matchPts,
        top3_points: top3row?.points ?? 0,
        total: matchPts + (top3row?.points ?? 0),
        predictions_made: mine.length,
        top3_submitted_at: top3row?.submitted_at ?? null,
      };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  });

// ---------- Mutations ----------

const PredictionInput = z.object({
  match_id: z.string().uuid(),
  outcome: z.enum(["1", "X", "2"]),
  home_score: z.number().int().min(0).max(20),
  away_score: z.number().int().min(0).max(20),
  first_scorer_player_id: z.string().uuid().nullable().optional(),
  scorer_ids: z.array(z.string().uuid()).max(20).default([]),
});

export const upsertPrediction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PredictionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("predictions")
      .select("id")
      .eq("user_id", userId)
      .eq("match_id", data.match_id)
      .maybeSingle();

    let predictionId: string;
    if (existing) {
      const { error } = await supabase
        .from("predictions")
        .update({
          outcome: data.outcome,
          home_score: data.home_score,
          away_score: data.away_score,
          first_scorer_player_id: data.first_scorer_player_id ?? null,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      predictionId = existing.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("predictions")
        .insert({
          user_id: userId,
          match_id: data.match_id,
          outcome: data.outcome,
          home_score: data.home_score,
          away_score: data.away_score,
          first_scorer_player_id: data.first_scorer_player_id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      predictionId = inserted.id;
    }

    // Replace scorers
    await supabase.from("prediction_scorers").delete().eq("prediction_id", predictionId);
    if (data.scorer_ids.length > 0) {
      const rows = data.scorer_ids.map((player_id) => ({ prediction_id: predictionId, player_id }));
      const { error: sErr } = await supabase.from("prediction_scorers").insert(rows);
      if (sErr) throw new Error(sErr.message);
    }
    return { ok: true };
  });

const Top3Input = z.object({
  winner_team_id: z.string().uuid(),
  runner_up_team_id: z.string().uuid(),
  third_team_id: z.string().uuid(),
});

export const upsertTop3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Top3Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ids = [data.winner_team_id, data.runner_up_team_id, data.third_team_id];
    if (new Set(ids).size !== 3) throw new Error("Pick three distinct teams");

    // Lock if any knockout match has started
    const { data: ko } = await supabase
      .from("matches")
      .select("kickoff_at,stage")
      .neq("stage", "group")
      .order("kickoff_at")
      .limit(1);
    if (ko && ko.length > 0 && new Date(ko[0].kickoff_at) <= new Date()) {
      throw new Error("Top 3 predictions are locked — knockout stage has started");
    }

    const { error } = await supabase.from("top3_predictions").upsert({
      user_id: userId,
      winner_team_id: data.winner_team_id,
      runner_up_team_id: data.runner_up_team_id,
      third_team_id: data.third_team_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ProfileInput = z.object({
  name: z.string().min(1).max(100),
  department: z.string().max(100).nullable().optional(),
  avatar_url: z.string().url().nullable().optional().or(z.literal("")),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({
        name: data.name,
        department: data.department || null,
        avatar_url: data.avatar_url || null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
