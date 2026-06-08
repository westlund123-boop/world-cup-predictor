import { createServerFn } from "@tanstack/react-start";

// Public news feed from Fotbollskanalen's "vm-2026" tag.
// Server-fetched + cached briefly to dodge CORS and reduce calls.

export type NewsItem = {
  id: string;
  headline: string;
  slug: string;
  url: string;
  publishedAt: string;
  section: string | null;
  imageUrl: string | null;
};

let cache: { at: number; items: NewsItem[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

function refToImageUrl(ref?: string | null): string | null {
  if (!ref) return null;
  // image-{hash}-{w}x{h}-{ext}  →  https://cdn.sanity.io/images/6s7qmpsi/production/{hash}-{w}x{h}.{ext}
  const m = ref.match(/^image-([a-f0-9]+)-(\d+x\d+)-(\w+)$/i);
  if (!m) return null;
  const [, hash, dims, ext] = m;
  return `https://cdn.sanity.io/images/6s7qmpsi/production/${hash}-${dims}.${ext}?w=320&h=180&fit=crop&auto=format`;
}

export const getVmNews = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;

  try {
    const res = await fetch("https://www.fotbollskanalen.se/api/articles?tag=vm-2026", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; WC2026Predictor/1.0)" },
    });
    if (!res.ok) return cache?.items ?? [];
    const raw = (await res.json()) as Array<any>;
    const items: NewsItem[] = (raw ?? []).slice(0, 12).map((a) => ({
      id: String(a._id ?? a.slug),
      headline: String(a.headline ?? ""),
      slug: String(a.slug ?? ""),
      url: `https://www.fotbollskanalen.se/artiklar/${a.slug}/`,
      publishedAt: String(a.publishDate ?? ""),
      section: a.section?.name ?? null,
      imageUrl:
        refToImageUrl(a.coverImage?.asset?._ref) ??
        refToImageUrl(a.fallbackImage?.asset?._ref),
    }));
    cache = { at: Date.now(), items };
    return items;
  } catch {
    return cache?.items ?? [];
  }
});
