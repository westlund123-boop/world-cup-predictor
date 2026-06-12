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

async function firecrawlSearchUrls(query: string, limit = 5): Promise<string[]> {
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!fcKey) return [];
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fcKey}` },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    console.error("[team-form] search HTTP", res.status, "for query:", query);
    return [];
  }
  const json: any = await res.json();
  const results = json?.data?.web ?? json?.web ?? json?.data ?? [];
  const arr = Array.isArray(results) ? results : [];
  return arr.map((r: any) => r?.url).filter((u: any): u is string => typeof u === "string");
}

async function tryScrape(url: string, attempts: string[]): Promise<string> {
  try {
    const md = await firecrawlScrape(url);
    attempts.push(`OK ${md.length}c ${url}`);
    return md;
  } catch (e: any) {
    attempts.push(`FAIL ${url}: ${e?.message ?? e}`);
    return "";
  }
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
  top_scorers: Array<{ name: string; goals: number; timeframe?: string }> | null;
  source: string | null;
  fetched_at: string;
};

function safeInt(v: any): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.floor(v));
}

function normalizeName(s: string): string {
  // Map common non-ASCII letters that don't decompose via NFD (Turkish ı/İ, Nordic ø/æ, etc.)
  const mapped = s
    .replace(/[ıİ]/g, "i")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[ß]/g, "ss")
    .replace(/[ðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[łŁ]/g, "l");
  return mapped
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadSquadNames(teamId: string): Promise<{ full: Set<string>; lasts: Set<string>; count: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("players").select("name").eq("team_id", teamId);
  const full = new Set<string>();
  const lasts = new Set<string>();
  (data ?? []).forEach((p: any) => {
    const n = normalizeName(p.name ?? "");
    if (!n) return;
    full.add(n);
    const parts = n.split(" ");
    if (parts.length) lasts.add(parts[parts.length - 1]);
  });
  return { full, lasts, count: data?.length ?? 0 };
}

function isInSquad(name: string, squad: { full: Set<string>; lasts: Set<string> }): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  if (squad.full.has(n)) return true;
  for (const f of squad.full) {
    if (f === n) return true;
    if (f.includes(" " + n) || f.startsWith(n + " ") || f.endsWith(" " + n)) return true;
    if (n.includes(" " + f) || n.startsWith(f + " ") || n.endsWith(" " + f)) return true;
  }
  const parts = n.split(" ");
  const last = parts[parts.length - 1];
  if (last && last.length >= 4 && squad.lasts.has(last)) return true;
  return false;
}

function sliceToResultsSection(md: string, maxLen = 90000): string {
  if (md.length <= maxLen) return md;
  // Find the most useful anchor and slice around it
  const anchors = [
    "## Results", "Results and fixtures", "Recent results",
    "Fixtures and results", "## Fixtures",
  ];
  let bestIdx = -1;
  for (const a of anchors) {
    const i = md.indexOf(a);
    if (i > -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx === -1) {
    // Fallback: find the LAST occurrence of "2025" or "2026" and slice around it
    const i2026 = md.lastIndexOf("2026");
    const i2025 = md.lastIndexOf("2025");
    bestIdx = Math.max(i2026, i2025);
  }
  if (bestIdx === -1) return md.slice(0, maxLen);
  const start = Math.max(0, bestIdx - 5000);
  return md.slice(start, start + maxLen);
}

async function extractTeamFormFromMarkdown(
  teamName: string,
  md: string,
  sourceLabel: string,
  squad: { full: Set<string>; lasts: Set<string> },
) {
  const trimmed = sliceToResultsSection(md, 90000);


  const system = `You extract structured football national-team form data from Wikipedia markdown. Return ONLY valid JSON matching the requested schema. Use null for any field you cannot verify from the provided text. NEVER invent numbers, results, or player names.`;

  const user = `Team: ${teamName}
Sources combined below (may include the team's main Wikipedia page and dedicated "results" sub-pages for 2025/2026).

Extract the team's most recent UP-TO-10 senior men's competitive matches (World Cup 2026 qualifiers, Nations League, friendlies, Copa/Gold Cup/Asian Cup/Euros/Africa Cup, confederation tournaments). Use ONLY matches that have a final score listed and a date in 2024, 2025, or 2026. Order MOST RECENT FIRST. Look in sections titled "Recent results", "Results and fixtures", "Fixtures and results", "2025", "2026", or in dedicated results sub-pages.

Return JSON with this exact shape:
{
  "last10_results": string | null,   // W/D/L sequence of up to 10 most recent matches, MOST RECENT FIRST, e.g. "WWDLW" (max 10 chars, only W/D/L)
  "wins": int | null,
  "draws": int | null,
  "losses": int | null,
  "goals_for": int | null,           // total goals scored across those matches
  "goals_against": int | null,
  "top_scorers": [ { "name": string, "goals": int } ] | null
}

HARD RULES — read carefully:
- last10_results: if you can only verify e.g. 6 matches, return a 6-char sequence and counts that sum to 6. Never pad. Never invent. If you cannot find at least 1 verifiable recent match, set all result fields to null.
- top_scorers: ONLY count goals scored within the SAME ≤10 recent matches above (the "senaste 10" window). Look through the match scorers/goal-scorers listed for each of those matches and tally them.
- ABSOLUTELY FORBIDDEN: do NOT use Wikipedia's "all-time top scorers", "most goals", "top scorers" career tables, or any career-totals table. Retired players (Tim Cahill, Hakan Şükür, Landon Donovan, etc.) must NEVER appear. If a name only shows up in an all-time list, IGNORE it.
- Up to 3 scorers. Skip any player whose recent-window goal tally you cannot verify from individual match results in the provided text.
- If no scorer goals can be tallied from the recent matches, return top_scorers: null.

Markdown:
---
${trimmed}
---`;

  const text = await callGemini(system, user, true);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Could not parse JSON from AI response");
    parsed = JSON.parse(m[0]);
  }

  const seq = typeof parsed.last10_results === "string"
    ? parsed.last10_results.toUpperCase().replace(/[^WDL]/g, "").slice(0, 10) || null
    : null;

  let scorers: Array<{ name: string; goals: number; timeframe: string }> | null = null;
  if (Array.isArray(parsed.top_scorers)) {
    const raw = parsed.top_scorers.filter(
      (s: any) => s && typeof s.name === "string" && typeof s.goals === "number" && s.goals > 0,
    );
    const kept: Array<{ name: string; goals: number; timeframe: string }> = [];
    for (const s of raw) {
      const name = s.name.trim();
      if (!isInSquad(name, squad)) {
        console.log(`[team-form] dropped non-squad scorer "${name}" for ${teamName}`);
        continue;
      }
      kept.push({ name, goals: Math.floor(s.goals), timeframe: "senaste 10" });
      if (kept.length >= 3) break;
    }
    scorers = kept.length ? kept : null;
  }

  return {
    last10_results: seq,
    wins: safeInt(parsed.wins),
    draws: safeInt(parsed.draws),
    losses: safeInt(parsed.losses),
    goals_for: safeInt(parsed.goals_for),
    goals_against: safeInt(parsed.goals_against),
    top_scorers: scorers,
    source: sourceLabel,
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

  const attempts: string[] = [];
  const squad = await loadSquadNames(teamId);
  console.log(`[team-form] starting fetch for ${teamName} (squad size ${squad.count})`);

  try {
    const slug = teamName.replace(/\s+/g, "_");
    const candidates: string[] = [
      `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}_national_football_team`,
      `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}_men%27s_national_soccer_team`,
      `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}_national_soccer_team`,
    ];

    // Search for results sub-pages and year pages
    const searchQueries = [
      `${teamName} men's national football team results 2025 2026 site:en.wikipedia.org`,
      `${teamName} national team 2025 results site:en.wikipedia.org`,
      `${teamName} 2026 FIFA World Cup qualification site:en.wikipedia.org`,
    ];
    for (const q of searchQueries) {
      const urls = await firecrawlSearchUrls(q, 4);
      for (const u of urls) {
        if (u.includes("wikipedia.org") && !candidates.includes(u)) candidates.push(u);
        if (candidates.length >= 8) break;
      }
      if (candidates.length >= 8) break;
    }

    // Scrape candidates and concatenate the useful ones
    const parts: string[] = [];
    let totalChars = 0;
    for (const url of candidates) {
      if (totalChars > 120000) break;
      const md = await tryScrape(url, attempts);
      if (md.length < 2000) continue; // skip stubs/redirects
      parts.push(`\n\n===== SOURCE: ${url} =====\n\n${md}`);
      totalChars += md.length;
    }

    if (parts.length === 0) {
      console.error(`[team-form] no usable sources for ${teamName}. Attempts:\n  ${attempts.join("\n  ")}`);
      return (cached as TeamFormRow) ?? null;
    }

    const combined = parts.join("\n");
    const sourceLabel = candidates.slice(0, parts.length).join(" | ");

    let extracted = await extractTeamFormFromMarkdown(teamName, combined, sourceLabel, squad);

    // Fallback if too few matches found
    if (!extracted.last10_results || extracted.last10_results.length < 5) {
      console.log(`[team-form] ${teamName} only got ${extracted.last10_results?.length ?? 0} results, trying fallback search`);
      const fbUrls = await firecrawlSearchUrls(`${teamName} men's national team recent results 2025 2026`, 5);
      const extra: string[] = [];
      for (const u of fbUrls.slice(0, 4)) {
        const md = await tryScrape(u, attempts);
        if (md.length >= 1000) extra.push(`\n\n===== FALLBACK SOURCE: ${u} =====\n\n${md}`);
      }
      if (extra.length) {
        const combined2 = combined + extra.join("\n");
        const extracted2 = await extractTeamFormFromMarkdown(teamName, combined2, sourceLabel + " | +fallback", squad);
        const len1 = extracted.last10_results?.length ?? 0;
        const len2 = extracted2.last10_results?.length ?? 0;
        if (len2 > len1) extracted = extracted2;
      }
    }

    // Honest omission threshold
    if (extracted.last10_results && extracted.last10_results.length < 5) {
      console.log(`[team-form] ${teamName} still only ${extracted.last10_results.length} verified results — omitting form. Attempts:\n  ${attempts.join("\n  ")}`);
      extracted.last10_results = null;
      extracted.wins = null;
      extracted.draws = null;
      extracted.losses = null;
      extracted.goals_for = null;
      extracted.goals_against = null;
    }

    const row = {
      team_id: teamId,
      ...extracted,
      fetched_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("team_form")
      .upsert(row, { onConflict: "team_id" });
    if (error) console.error("[team-form] upsert error:", error.message);
    console.log(`[team-form] refreshed ${teamName}:`, extracted.last10_results, `${extracted.goals_for}-${extracted.goals_against}`, "scorers:", extracted.top_scorers?.map(s => `${s.name}/${s.goals}`).join(",") ?? "none");
    return row as TeamFormRow;
  } catch (e: any) {
    console.error(`[team-form] failed for ${teamName}:`, e?.message ?? e, "\nAttempts:\n  " + attempts.join("\n  "));
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
    const s = f.top_scorers.map((x) => `${x.name} (${x.goals} mål)`).join(", ");
    lines.push(`Heta skyttar (senaste 10): ${s}`);
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
