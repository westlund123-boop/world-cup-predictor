// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const PUBLIC_BACKEND_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "https://nsnxakbpvvpiwrfurjqj.supabase.co";
const PUBLIC_BACKEND_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Im5zbnhha2JwdnZwaXdyZnVyanFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjM3OTMsImV4cCI6MjA5NjEzOTc5M30.nVAKamCOortx5LOwlZyeDvJubnglsGKtSsd0yVS5WIM";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        PUBLIC_BACKEND_URL,
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        PUBLIC_BACKEND_KEY,
      ),
      "import.meta.env.SUPABASE_URL": JSON.stringify(
        PUBLIC_BACKEND_URL,
      ),
      "import.meta.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        PUBLIC_BACKEND_KEY,
      ),
      "process.env.SUPABASE_URL": JSON.stringify(
        PUBLIC_BACKEND_URL,
      ),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        PUBLIC_BACKEND_KEY,
      ),
    },
  },
});
