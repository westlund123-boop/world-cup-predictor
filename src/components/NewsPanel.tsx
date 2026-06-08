import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getVmNews } from "@/lib/news.functions";
import { Card } from "@/components/ui/card";
import { Newspaper, ExternalLink } from "lucide-react";

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "nyss";
  if (diff < 3600) return `${Math.floor(diff / 60)} min sedan`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} tim sedan`;
  return `${Math.floor(diff / 86400)} dgr sedan`;
}

export function NewsPanel() {
  const fn = useServerFn(getVmNews);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["vm-news"],
    queryFn: () => fn(),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">VM-nyheter</h2>
        </div>
        <a
          href="https://www.fotbollskanalen.se/liga/fotbolls-vm-herr"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          fotbollskanalen.se <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <Card className="divide-y divide-border overflow-hidden">
        {isLoading && items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Laddar nyheter…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Inga nyheter just nu.
          </div>
        ) : (
          items.slice(0, 8).map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 p-3 hover:bg-muted/40 transition-colors group"
            >
              {n.imageUrl ? (
                <img
                  src={n.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-16 w-24 object-cover rounded-md shrink-0 bg-muted"
                />
              ) : (
                <div className="h-16 w-24 rounded-md bg-muted shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug line-clamp-3 group-hover:text-primary transition-colors">
                  {n.headline}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{timeAgo(n.publishedAt)}</span>
                  {n.section && (
                    <>
                      <span>·</span>
                      <span className="px-1.5 py-0.5 rounded bg-muted">{n.section}</span>
                    </>
                  )}
                </div>
              </div>
            </a>
          ))
        )}
      </Card>
    </div>
  );
}
