import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/diag")({
  server: {
    handlers: {
      GET: async () => {
        const present = (k: string) => {
          const v = process.env[k];
          return v ? `set(len=${v.length})` : "MISSING";
        };
        const body = {
          SUPABASE_URL: present("SUPABASE_URL"),
          SUPABASE_PUBLISHABLE_KEY: present("SUPABASE_PUBLISHABLE_KEY"),
          SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
          VITE_SUPABASE_URL: present("VITE_SUPABASE_URL"),
          NODE_ENV: process.env.NODE_ENV ?? null,
        };
        return new Response(JSON.stringify(body, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
