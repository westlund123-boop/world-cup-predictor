import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ match_id: z.string().uuid() });

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

async function firecrawlSearch(query: string): Promise<string> {
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!fcKey) {
    throw new Error("FIRECRAWL_API_KEY saknas i servermiljön");
  }
  console.log("[match-preview] firecrawl query:", query);
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fcKey}`,
    },
    body: JSON.stringify({
      query,
      limit: 5,
      tbs: "qdr:m",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[match-preview] firecrawl HTTP", res.status, body);
    throw new Error(`Firecrawl-sökning misslyckades (${res.status}): ${body.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const results = json?.data?.web ?? json?.web ?? json?.data ?? [];
  const arr = Array.isArray(results) ? results : [];
  console.log("[match-preview] firecrawl results:", arr.length);
  return arr
    .slice(0, 5)
    .map((r: any) => {
      const title = r?.title ?? "";
      const url = r?.url ?? "";
      const desc = r?.description ?? r?.snippet ?? "";
      return `- ${title} (${url})\n  ${desc}`;
    })
    .join("\n");
}

async function generateWithGemini(homeName: string, awayName: string, kickoffISO: string, evidence: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");

  const system = `Du är en sportreporter som skriver korta, lekfulla matchförhandsanalyser på svenska för fotbolls-VM 2026. 
KRITISKT: Använd ENDAST fakta från "Webbsökningsresultat" nedan. Om du inte hittar verifierbara fakta om något, hoppa över det helt. Hitta INTE på statistik, formresultat, skador eller annat. Skriv inga vinstodds eller procentuella sannolikheter.`;

  const user = `Match: ${homeName} vs ${awayName}
Avspark: ${kickoffISO}

Webbsökningsresultat (din enda källa till fakta):
${evidence || "(inga sökresultat tillgängliga)"}

Skriv en förhandsanalys på svenska enligt EXAKT detta format (max 120 ord totalt):

**Heta trender**
- (kort punkt om något lag, endast om du har stöd i källorna)
- (kort punkt)
- (valfri tredje punkt)

**Att hålla koll på**
(1–2 nyckelspelare eller taktiska detaljer — endast om nämnda i källorna)

**Prediktion**
(en lekfull enradare, ingen procentsiffra)

Ton: kvick, lätt humoristisk, men sansad. Om sökresultaten är tomma, skriv kort: "Inga färska nyheter hittades — vi får helt enkelt vänta och se!"`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (res.status === 429) throw new Error("AI rate limit — försök igen om en stund");
  if (res.status === 402) throw new Error("AI-krediterna är slut för den här arbetsytan");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}`);

  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Tomt svar från AI");
  return text;
}

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
  const home = teams?.find((t) => t.id === match.home_team_id)?.name ?? "Hemmalag";
  const away = teams?.find((t) => t.id === match.away_team_id)?.name ?? "Bortalag";

  const query = `${home} vs ${away} World Cup 2026 form recent results injuries key players`;
  const evidence = await firecrawlSearch(query);
  const content = await generateWithGemini(home, away, match.kickoff_at, evidence);

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
