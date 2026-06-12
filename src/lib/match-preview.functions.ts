import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ match_id: z.string().uuid() });

const TEAM_FORM_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

async function isAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

async function fetchCached(match_id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("match_previews")
    .select("content,generated_at")
    .eq("match_id", match_id)
    .maybeSingle();
  return data;
}

// --- Firecrawl helpers ---

async function firecrawlScrape(url: string): Promise<string> {
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!fcKey) throw new Error("FIRECRAWL_API_KEY saknas i servermiljön");
  console.log("[team-form] firecrawl scrape:", url);
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fcKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[team-form] scrape HTTP", res.status, body.slice(0, 200));
    throw new Error(`Firecrawl scrape failed (${res.status})`);
  }
  const json: any = await res.json();
  const md = json?.data?.markdown ?? json?.markdown ?? "";
  console.log("[team-form] scraped chars:", md.length);
  return md;
}

async function firecrawlSearchUrl(query: string): Promise<string | null> {
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!fcKey) return null;
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fcKey}` },
    body: JSON.stringify({ query, limit: 3 }),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const results = json?.data?.web ?? json?.web ?? json?.data ?? [];
  const arr = Array.isArray(results) ? results : [];
  const wiki = arr.find((r: any) => typeof r?.url === "string" && r.url.includes("wikipedia.org"));
  return wiki?.url ?? arr[0]?.url ?? null;
}

// --- Gemini helpers ---

async function callGemini(system: string, user: string, expectJson = false): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const body: any = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (expectJson) body.response_format = { type: "json_object" };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("AI rate limit — försök igen om en stund");
  if (res.status === 402) throw new Error("AI-krediterna är slut för den här arbetsytan");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}`);
  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Tomt svar från AI");
  return text;
}

// --- Team form extraction ---

type TeamFormRow = {
  team_id: string;
  last10_results: string | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  top_scorers: Array<{ name: string; goals: number }> | null;
  source: string | null;
  fetched_at: string;
};

function safeInt(v: any): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.floor(v));
}

async function extractTeamFormFromMarkdown(teamName: string, md: string, sourceUrl: string) {
  // Truncate very long pages
  const trimmed = md.length > 60000 ? md.slice(0, 60000) : md;

  const system = `You extract structured football national-team form data from Wikipedia markdown. Return ONLY valid JSON matching the requested schema. Use null for any field you cannot verify from the provided text. NEVER invent numbers, results, or player names.`;

  const user = `Team: ${teamName}
Source: ${sourceUrl}

From the Wikipedia markdown below, extract the team's most recent competitive senior men's national-team matches (qualifiers, Nations League, friendlies, tournaments). Look in "Recent results", "Fixtures and results", "Results and fixtures" or similar sections. Use ONLY matches that have a final score listed.

Return JSON with this exact shape:
{
  "last10_results": string | null,   // W/D/L sequence of up to 10 most recent matches, MOST RECENT FIRST, e.g. "WWDLW" (max 10 chars, only W/D/L)
  "wins": int | null,                // wins within those matches
  "draws": int | null,
  "losses": int | null,
  "goals_for": int | null,           // total goals scored across those matches
  "goals_against": int | null,
  "top_scorers": [ { "name": string, "goals": int } ] | null  // up to 3 most prolific recent scorers if a "Top scorers" / "Goalscorers" table is present, else null
}

Rules:
- If you can only verify e.g. 4 matches, return a 4-char sequence and counts that sum to 4. Never pad.
- If you cannot find any verifiable recent results at all, return all-null fields.
- Do NOT include players whose goal counts you cannot read from the page.

Wikipedia markdown:
---
${trimmed}
---`;

  const text = await callGemini(system, user, true);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // sometimes wrapped in ```json
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Could not parse JSON from AI response");
    parsed = JSON.parse(m[0]);
  }

  const seq = typeof parsed.last10_results === "string"
    ? parsed.last10_results.toUpperCase().replace(/[^WDL]/g, "").slice(0, 10) || null
    : null;

  let scorers: Array<{ name: string; goals: number }> | null = null;
  if (Array.isArray(parsed.top_scorers)) {
    scorers = parsed.top_scorers
      .filter((s: any) => s && typeof s.name === "string" && typeof s.goals === "number" && s.goals > 0)
      .slice(0, 3)
      .map((s: any) => ({ name: s.name.trim(), goals: Math.floor(s.goals) }));
    if (scorers!.length === 0) scorers = null;
  }

  return {
    last10_results: seq,
    wins: safeInt(parsed.wins),
    draws: safeInt(parsed.draws),
    losses: safeInt(parsed.losses),
    goals_for: safeInt(parsed.goals_for),
    goals_against: safeInt(parsed.goals_against),
    top_scorers: scorers,
    source: sourceUrl,
  };
}

async function getTeamForm(teamId: string, teamName: string): Promise<TeamFormRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: cached } = await supabaseAdmin
    .from("team_form")
    .select("*")
    .eq("team_id", teamId)
    .maybeSingle();

  if (cached && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < TEAM_FORM_TTL_MS) {
      console.log(`[team-form] cache hit for ${teamName} (age ${Math.round(age / 3600000)}h)`);
      return cached as TeamFormRow;
    }
  }

  try {
    // Try direct Wikipedia URL, fall back to search
    const slug = teamName.replace(/\s+/g, "_");
    const directUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}_national_football_team`;
    let url = directUrl;
    let md = "";
    try {
      md = await firecrawlScrape(directUrl);
      // Real national-team pages are huge (>50k chars). Anything smaller
      // is almost certainly a disambig/redirect stub (e.g. Canada uses
      // "men's national soccer team" instead of "football team").
      if (md.length < 20000) throw new Error("page too small / not the team page");
    } catch (e) {
      console.log(`[team-form] direct URL too thin for ${teamName}, searching…`);
      const found = await firecrawlSearchUrl(`${teamName} men's national football soccer team site:en.wikipedia.org`);
      if (!found) throw new Error("no wikipedia page found");
      url = found;
      md = await firecrawlScrape(found);
    }

    const extracted = await extractTeamFormFromMarkdown(teamName, md, url);
    const row = {
      team_id: teamId,
      ...extracted,
      fetched_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("team_form")
      .upsert(row, { onConflict: "team_id" });
    if (error) console.error("[team-form] upsert error:", error.message);
    console.log(`[team-form] refreshed ${teamName}:`, extracted.last10_results, `${extracted.goals_for}-${extracted.goals_against}`);
    return row as TeamFormRow;
  } catch (e: any) {
    console.error(`[team-form] failed for ${teamName}:`, e?.message ?? e);
    // Return stale cache if available, otherwise null
    return (cached as TeamFormRow) ?? null;
  }
}

// --- Render helpers ---

function renderFormBlock(teamName: string, f: TeamFormRow | null): string {
  if (!f || (!f.last10_results && !f.top_scorers)) return "";
  const lines: string[] = [`**${teamName}**`];
  if (f.last10_results) {
    const n = f.last10_results.length;
    const totals = f.goals_for !== null && f.goals_against !== null
      ? ` — ${f.goals_for} gjorda, ${f.goals_against} insläppta`
      : "";
    lines.push(`Form: ${f.last10_results} (senaste ${n})${totals}`);
  }
  if (f.top_scorers && f.top_scorers.length > 0) {
    const s = f.top_scorers
      .map((x) => `${x.name} (${x.goals} mål)`)
      .join(", ");
    lines.push(`Heta skyttar: ${s}`);
  }
  return lines.join("\n");
}

// --- Witty commentary ---

async function generateCommentary(
  homeName: string,
  awayName: string,
  kickoffISO: string,
  homeForm: TeamFormRow | null,
  awayForm: TeamFormRow | null,
): Promise<string> {
  const context = [
    homeForm ? `${homeName}: form ${homeForm.last10_results ?? "okänt"}, mål ${homeForm.goals_for ?? "?"}-${homeForm.goals_against ?? "?"}, skyttar ${(homeForm.top_scorers ?? []).map(s => `${s.name} ${s.goals}`).join("; ") || "okänt"}` : `${homeName}: ingen formdata`,
    awayForm ? `${awayName}: form ${awayForm.last10_results ?? "okänt"}, mål ${awayForm.goals_for ?? "?"}-${awayForm.goals_against ?? "?"}, skyttar ${(awayForm.top_scorers ?? []).map(s => `${s.name} ${s.goals}`).join("; ") || "okänt"}` : `${awayName}: ingen formdata`,
  ].join("\n");

  const system = `Du är en kvick svensk fotbollsskribent. Skriv kort, lekfullt och faktabaserat. Hitta ALDRIG på siffror eller spelarnamn — använd bara det du får i kontexten. Inga procentuella sannolikheter, inga odds.`;

  const user = `Match: ${homeName} vs ${awayName} (avspark ${kickoffISO})

Kontext (din enda källa till siffror):
${context}

Skriv EXAKT detta format på svenska (max 70 ord totalt):

**Att hålla koll på**
1–2 korta punkter om vad som blir avgörande, gärna med en referens till siffrorna ovan (t.ex. en av lagens form eller målskillnad). Hoppa över om kontexten är tom.

**Prediktion**
En lekfull enradare. Ingen procentsiffra.`;

  return await callGemini(system, user, false);
}

// --- Main generation ---

async function generateAndStore(match_id: string): Promise<{ content: string; generated_at: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: match, error: mErr } = await supabaseAdmin
    .from("matches")
    .select("id,kickoff_at,home_team_id,away_team_id")
    .eq("id", match_id)
    .maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!match || !match.home_team_id || !match.away_team_id) {
    throw new Error("Matchen är inte fullständig (lagen är inte bestämda än)");
  }

  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("id,name")
    .in("id", [match.home_team_id, match.away_team_id]);
  const home = teams?.find((t) => t.id === match.home_team_id);
  const away = teams?.find((t) => t.id === match.away_team_id);
  if (!home || !away) throw new Error("Lagdata saknas");

  const [homeForm, awayForm] = await Promise.all([
    getTeamForm(home.id, home.name),
    getTeamForm(away.id, away.name),
  ]);

  const statsBlocks = [renderFormBlock(home.name, homeForm), renderFormBlock(away.name, awayForm)]
    .filter(Boolean)
    .join("\n\n");

  const commentary = await generateCommentary(home.name, away.name, match.kickoff_at, homeForm, awayForm);

  const content = statsBlocks ? `${statsBlocks}\n\n${commentary}` : commentary;

  const { data: saved, error: sErr } = await supabaseAdmin
    .from("match_previews")
    .upsert({ match_id, content, generated_at: new Date().toISOString() }, { onConflict: "match_id" })
    .select("content,generated_at")
    .single();
  if (sErr) throw new Error(sErr.message);
  return saved;
}

// Read cached preview only (no generation). Returns null if missing.
export const getMatchPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const cached = await fetchCached(data.match_id);
    return cached ?? null;
  });

// Generate-if-missing. Any signed-in user can trigger first generation.
export const ensureMatchPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const cached = await fetchCached(data.match_id);
    if (cached) return cached;
    return await generateAndStore(data.match_id);
  });

// Force regenerate — admin only.
export const regenerateMatchPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase, context.userId))) {
      throw new Error("Forbidden: admin only");
    }
    return await generateAndStore(data.match_id);
  });
