import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import {
  adminGetAllPlayers,
  adminUpsertPlayer,
  adminSetPlayerActive,
  adminImportPlayersCSV,
  adminExportPlayersCSV,
} from "@/lib/admin.functions";
import { getTeams, getMyProfile } from "@/lib/wc.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Upload, Pencil, Plus, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/squads")({
  head: () => ({ meta: [{ title: "Squads — WC 2026 Predictor" }] }),
  component: SquadsPage,
});

function SquadsPage() {
  const meFn = useServerFn(getMyProfile);
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!me?.isAdmin) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-bold">Admin only</h1>
        <p className="text-sm text-muted-foreground mt-2">You need an admin role to manage squads.</p>
      </Card>
    );
  }
  return <SquadsInner />;
}

function SquadsInner() {
  const qc = useQueryClient();
  const playersFn = useServerFn(adminGetAllPlayers);
  const teamsFn = useServerFn(getTeams);
  const importFn = useServerFn(adminImportPlayersCSV);
  const exportFn = useServerFn(adminExportPlayersCSV);
  const setActiveFn = useServerFn(adminSetPlayerActive);

  const { data: players = [] } = useQuery({ queryKey: ["admin-players"], queryFn: () => playersFn() });
  const { data: teams = [] } = useQuery({ queryKey: ["teams"], queryFn: () => teamsFn() });
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const [teamFilter, setTeamFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = players.filter((p: any) => {
    if (teamFilter && p.team_id !== teamFilter) return false;
    if (!showInactive && !p.active) return false;
    if (search) {
      const q = search.toLowerCase();
      const team = teamMap.get(p.team_id);
      const hay = `${p.name} ${p.name_on_shirt ?? ""} ${p.position ?? ""} ${p.club ?? ""} ${p.shirt_number ?? ""} ${team?.name ?? ""} ${team?.code ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const exportCsv = useMutation({
    mutationFn: () => exportFn(),
    onSuccess: (r) => {
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = r.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("Squads CSV exported");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importCsv = useMutation({
    mutationFn: (args: { csv: string; mode: "upsert" | "replace_team" }) => importFn({ data: args }),
    onSuccess: (r) => {
      toast.success("Squads imported", {
        description: `${r.inserted} inserted${r.deactivated ? `, ${r.deactivated} deactivated` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      qc.invalidateQueries({ queryKey: ["players"] });
    },
    onError: (e: Error) => toast.error("Import failed", { description: e.message }),
  });

  const setActive = useMutation({
    mutationFn: (args: { id: string; active: boolean }) => setActiveFn({ data: args }),
    onSuccess: () => {
      toast.success("Player updated");
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      qc.invalidateQueries({ queryKey: ["players"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>, mode: "upsert" | "replace_team") => {
    const f = e.target.files?.[0];
    if (!f) return;
    const csv = await f.text();
    importCsv.mutate({ csv, mode });
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Squad management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage player rosters for all 48 teams. Use CSV import/export for bulk updates and late injury replacements.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
            <Download className="h-4 w-4 mr-1.5" />
            {exportCsv.isPending ? "Exporting…" : "Export CSV"}
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => onFile(e, "upsert")} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importCsv.isPending}>
            <Upload className="h-4 w-4 mr-1.5" />
            {importCsv.isPending ? "Importing…" : "Import CSV (upsert)"}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add player
          </Button>
        </div>
      </header>

      <Card className="p-4 flex items-start gap-3 border-primary/20 bg-primary/5">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs text-foreground/80 space-y-1">
          <p>
            <strong>Source of truth:</strong> player data is meant to match the official FIFA 2026 final squad list submitted by each federation. Update via CSV when squads are confirmed, or edit individual players for late injury replacements.
          </p>
          <p>
            <strong>CSV format:</strong> <code className="font-mono">team_code,name,name_on_shirt,position,shirt_number,club,active</code>. Predictions made for a deactivated player are preserved — the player is hidden rather than deleted.
          </p>
        </div>
      </Card>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Team</Label>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
          >
            <option value="">All teams ({teams.length})</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.flag_emoji} {t.name} ({t.code})</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, number, club, team…" className="mt-1" />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30">
          {filtered.length} player{filtered.length === 1 ? "" : "s"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-center">#</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Pos</th>
                <th className="px-3 py-2 text-left">Club</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p: any) => {
                const team = teamMap.get(p.team_id);
                return (
                  <tr key={p.id} className={`hover:bg-muted/30 ${!p.active ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="mr-1.5">{team?.flag_emoji}</span>
                      <span className="text-xs font-mono">{team?.code}</span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {p.shirt_number ?? "—"}
                    </td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.position ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.club ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {p.active ? <Badge variant="default" className="text-[10px]">Active</Badge> : <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => setActive.mutate({ id: p.id, active: !p.active })}>
                        {p.active ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">
                  No players match these filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {(editing || creating) && (
        <PlayerDialog
          player={editing}
          teams={teams}
          defaultTeamId={teamFilter || undefined}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["admin-players"] });
            qc.invalidateQueries({ queryKey: ["players"] });
          }}
        />
      )}
    </div>
  );
}

function PlayerDialog({
  player, teams, defaultTeamId, onClose, onSaved,
}: {
  player: any | null;
  teams: any[];
  defaultTeamId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [teamId, setTeamId] = useState(player?.team_id ?? defaultTeamId ?? teams[0]?.id ?? "");
  const [name, setName] = useState(player?.name ?? "");
  const [nameOnShirt, setNameOnShirt] = useState(player?.name_on_shirt ?? "");
  const [position, setPosition] = useState(player?.position ?? "");
  const [shirtNumber, setShirtNumber] = useState<string>(player?.shirt_number?.toString() ?? "");
  const [club, setClub] = useState(player?.club ?? "");
  const [active, setActive] = useState<boolean>(player?.active ?? true);

  const fn = useServerFn(adminUpsertPlayer);
  const save = useMutation({
    mutationFn: () => fn({
      data: {
        id: player?.id,
        team_id: teamId,
        name: name.trim(),
        name_on_shirt: nameOnShirt.trim() || null,
        position: position.trim() || null,
        shirt_number: shirtNumber ? Number(shirtNumber) : null,
        club: club.trim() || null,
        active,
      },
    }),
    onSuccess: () => { toast.success(player ? "Player updated" : "Player added"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{player ? "Edit player" : "Add player"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Team</Label>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
              className="mt-1 w-full h-9 px-3 rounded-md border border-input bg-background text-sm">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.flag_emoji} {t.name} ({t.code})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Shirt #</Label>
              <Input type="number" min={1} max={99} value={shirtNumber} onChange={(e) => setShirtNumber(e.target.value)} />
            </div>
            <div>
              <Label>Position</Label>
              <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="GK / DF / MF / FW" />
            </div>
          </div>
          <div>
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Name on shirt</Label>
            <Input value={nameOnShirt} onChange={(e) => setNameOnShirt(e.target.value)} />
          </div>
          <div>
            <Label>Club</Label>
            <Input value={club} onChange={(e) => setClub(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (selectable in predictions)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim() || !teamId}>
            {save.isPending ? "Saving…" : "Save player"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
