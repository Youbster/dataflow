"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Sparkles, Flame,
  Loader2, ExternalLink, Heart, Check,
} from "lucide-react";
import { toast } from "sonner";
import { PlayOnSpotify } from "@/components/shared/play-on-spotify";

// ─── Section labels ───────────────────────────────────────────────────────────
const SECTION_META = {
  anchor:    { label: "Setting the tone",    color: "text-primary",     bg: "bg-primary/15",    dot: "bg-primary"     },
  groove:    { label: "Finding your groove", color: "text-orange-400",  bg: "bg-orange-500/15", dot: "bg-orange-400"  },
  discovery: { label: "This one's for you",  color: "text-emerald-400", bg: "bg-emerald-500/15",dot: "bg-emerald-400" },
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase = "pick" | "loading" | "result";

interface RecentTrack {
  spotifyTrackId: string;
  trackName: string;
  artistName: string;
  albumImageUrl: string | null;
  playCount: number;
}

interface PlaylistTrack {
  trackName: string;
  artistName: string;
  section: "anchor" | "groove" | "discovery";
  reason: string;
  spotifyTrackId?: string | null;
  spotifyUri?: string | null;
  albumImageUrl?: string | null;
}

interface GeneratedPlaylist {
  intro: string;
  tracks: PlaylistTrack[];
  playlistId?: string | null;
}

interface HomeData {
  stats: { playsThisWeek: number; estimatedMinutes: number; uniqueArtists: number; topGenre: string | null };
  recentTopTracks: RecentTrack[];
  vibe: { word: string; sentence: string } | null;
  burnout: { trackName: string; artistName: string; pct: number } | null;
}

// ─── Pill ─────────────────────────────────────────────────────────────────────
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
        active
          ? "border-primary bg-primary/20 text-primary"
          : "border-border bg-accent/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [homeData, setHomeData]         = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading]   = useState(true);
  const [syncing, setSyncing]           = useState(false);

  // generator
  const [phase, setPhase]               = useState<Phase>("pick");
  const [promptText, setPromptText]     = useState("");
  const [seedTrack, setSeedTrack]       = useState<RecentTrack | null>(null);
  const [sessionMins, setSessionMins]   = useState<20 | 60 | 120>(60);
  const [playlist, setPlaylist]         = useState<GeneratedPlaylist | null>(null);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [savedToSpotify, setSavedToSpotify] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { syncThenLoad(); }, []);

  async function syncThenLoad() {
    try {
      await fetch("/api/spotify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: false }) });
    } catch { /* non-fatal */ }
    await loadHome();
  }

  async function loadHome() {
    setHomeLoading(true);
    try {
      const res = await fetch("/api/ai/home");
      if (res.ok) setHomeData(await res.json());
    } catch { /* silent */ }
    finally { setHomeLoading(false); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/spotify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      if (res.ok) { toast.success("Synced!"); await loadHome(); }
      else { const d = await res.json(); toast.error(d.error || "Sync failed"); }
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  }

  async function generate() {
    if (!promptText.trim() && !seedTrack) return;
    setPhase("loading");
    try {
      const res = await fetch("/api/ai/mood-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText.trim(),
          seedTrack: seedTrack ? { trackName: seedTrack.trackName, artistName: seedTrack.artistName } : null,
          sessionMinutes: sessionMins,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlaylist(data);
      setPhase("result");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate playlist");
      setPhase("pick");
    }
  }

  function reset() {
    setPhase("pick");
    setPromptText("");
    setSeedTrack(null);
    setPlaylist(null);
    setFeedbackMode(false);
    setSavedToSpotify(false);
    setIsSaving(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }

  async function handleSaveToSpotify() {
    if (!playlist || isSaving || savedToSpotify) return;
    const playableUris = playlist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!);
    if (playableUris.length === 0) return;
    setIsSaving(true);
    try {
      const label = seedTrack
        ? `Built around "${seedTrack.trackName}"`
        : promptText.slice(0, 40) || "My Playlist";
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlist.playlistId ?? null, name: `${label} — ${dateLabel}`, description: playlist.intro, trackUris: playableUris }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSavedToSpotify(true);
      toast.success("Playlist saved to Spotify!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save to Spotify");
    } finally {
      setIsSaving(false);
    }
  }

  const canGenerate = promptText.trim().length > 0 || seedTrack !== null;

  return (
    <div className="space-y-5 md:space-y-8 max-w-4xl mx-auto">

      {/* ── Generator ──────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card">

        {/* ── PICK ─────────────────────────────────────────────────────────── */}
        {phase === "pick" && (
          <div className="p-4 space-y-4">

            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold leading-tight">Generate a playlist</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {homeData?.vibe
                    ? `Your week has been ${homeData.vibe.word.toLowerCase()} — describe what you need`
                    : "Describe what you need and we'll build it"}
                </p>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                title="Sync from Spotify"
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 mt-0.5 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Text input */}
            <textarea
              ref={textareaRef}
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                if (e.target.value) setSeedTrack(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canGenerate) {
                  e.preventDefault();
                  generate();
                }
              }}
              placeholder="e.g. late night drive, nostalgic but not sad... or pre-game warmup, high energy no lyrics"
              rows={2}
              className="w-full resize-none rounded-xl bg-accent/50 border border-border px-3.5 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
            />

            {/* Seed from recent tracks */}
            {!homeLoading && (homeData?.recentTopTracks.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border/40" />
                  <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest shrink-0">
                    or start from a track
                  </p>
                  <div className="flex-1 h-px bg-border/40" />
                </div>
                <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none">
                  {homeData!.recentTopTracks.slice(0, 5).map((t) => {
                    const isSelected = seedTrack?.spotifyTrackId === t.spotifyTrackId;
                    return (
                      <button
                        key={t.spotifyTrackId}
                        onClick={() => {
                          setSeedTrack(isSelected ? null : t);
                          if (!isSelected) setPromptText("");
                        }}
                        className={`flex items-center gap-2 rounded-xl px-2.5 py-2 border shrink-0 transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-accent/40 hover:border-border/80 hover:bg-accent/60"
                        }`}
                      >
                        {t.albumImageUrl && (
                          <img
                            src={t.albumImageUrl}
                            alt={t.trackName}
                            className="w-7 h-7 rounded object-cover shrink-0"
                          />
                        )}
                        <div className="text-left">
                          <p className="text-xs font-medium truncate max-w-[90px] leading-snug">{t.trackName}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[90px]">{t.artistName}</p>
                        </div>
                        {isSelected && <Check className="w-3 h-3 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Loading skeleton for seed tracks */}
            {homeLoading && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-32 rounded-xl shrink-0" />
                ))}
              </div>
            )}

            {/* Duration */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Duration</p>
              <div className="flex gap-1.5">
                <Pill active={sessionMins === 20}  onClick={() => setSessionMins(20)}>20 min</Pill>
                <Pill active={sessionMins === 60}  onClick={() => setSessionMins(60)}>1 hour</Pill>
                <Pill active={sessionMins === 120} onClick={() => setSessionMins(120)}>2 hr+</Pill>
              </div>
            </div>

            {/* Generate */}
            <Button
              onClick={generate}
              disabled={!canGenerate}
              className="w-full h-11 text-sm font-semibold"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Build my playlist
            </Button>
          </div>
        )}

        {/* ── LOADING ──────────────────────────────────────────────────────── */}
        {phase === "loading" && (
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
            <div>
              <p className="font-bold text-lg">Building your arc…</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Reading your taste, blocking overplayed songs, finding the right discoveries
              </p>
            </div>
          </div>
        )}

        {/* ── RESULT ───────────────────────────────────────────────────────── */}
        {phase === "result" && playlist && (
          <div className="p-5 space-y-5">
            {(() => {
              const playableUris = playlist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!);
              return (
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {seedTrack ? (
                        <>
                          {seedTrack.albumImageUrl && (
                            <img src={seedTrack.albumImageUrl} className="w-5 h-5 rounded shrink-0 object-cover" alt="" />
                          )}
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest truncate">
                            Based on {seedTrack.trackName}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest truncate max-w-[220px]">
                          &ldquo;{promptText.length > 50 ? promptText.slice(0, 50) + "…" : promptText}&rdquo;
                        </span>
                      )}
                      <span className="text-muted-foreground/30 text-xs">·</span>
                      <span className="text-xs text-muted-foreground">
                        {sessionMins === 20 ? "20 min" : sessionMins === 60 ? "1 hr" : "2 hr+"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground italic leading-relaxed">{playlist.intro}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {playableUris.length > 0 && <PlayOnSpotify uris={playableUris} label="Play" />}
                    {playableUris.length > 0 && (
                      <button
                        onClick={handleSaveToSpotify}
                        disabled={isSaving || savedToSpotify}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                          savedToSpotify
                            ? "border-primary/50 bg-primary/10 text-primary cursor-default"
                            : "border-border bg-accent/50 text-muted-foreground hover:text-primary hover:border-primary/40"
                        }`}
                      >
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedToSpotify ? <Check className="w-3.5 h-3.5" /> : <Heart className="w-3.5 h-3.5" />}
                        {savedToSpotify ? "Saved" : "Save"}
                      </button>
                    )}
                    <button
                      onClick={reset}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      New
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Track list */}
            {(["anchor", "groove", "discovery"] as const).map((section) => {
              const sectionTracks = playlist.tracks.filter(t => t.section === section);
              if (!sectionTracks.length) return null;
              const meta = SECTION_META[section];
              return (
                <div key={section} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${meta.color}`}>{meta.label}</p>
                  </div>
                  <div className="space-y-1">
                    {sectionTracks.map((t, i) => (
                      <a
                        key={i}
                        href={t.spotifyTrackId ? `https://open.spotify.com/track/${t.spotifyTrackId}` : `https://open.spotify.com/search/${encodeURIComponent(`${t.trackName} ${t.artistName}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl bg-accent/30 hover:bg-accent border border-transparent hover:border-border/60 p-2.5 transition-all group"
                      >
                        {t.albumImageUrl ? (
                          <img src={t.albumImageUrl} alt={t.trackName} className="w-9 h-9 rounded-md object-cover shrink-0" />
                        ) : (
                          <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 text-[10px] font-bold ${meta.bg} ${meta.color}`}>{i + 1}</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm group-hover:text-primary transition-colors leading-snug truncate">
                            {t.trackName} <span className="text-muted-foreground font-normal">· {t.artistName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground/60 mt-0.5 italic truncate">{t.reason}</p>
                        </div>
                        <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary shrink-0 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Feedback */}
            {!feedbackMode ? (
              <button
                onClick={() => setFeedbackMode(true)}
                className="w-full text-xs text-muted-foreground/50 hover:text-muted-foreground border border-dashed border-border/40 hover:border-border rounded-xl py-2 transition-all"
              >
                Something off?
              </button>
            ) : (
              <div className="rounded-xl border border-border bg-accent/20 p-4 space-y-3">
                <p className="text-sm font-medium">Which track felt off?</p>
                <div className="flex flex-wrap gap-2">
                  {playlist.tracks.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => { toast.success(`Noted — won't include "${t.trackName}" next time`); setFeedbackMode(false); }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-accent border border-border hover:border-red-500/50 hover:text-red-400 transition-colors"
                    >
                      {t.trackName}
                    </button>
                  ))}
                </div>
                <button onClick={() => setFeedbackMode(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Never mind
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Burnout Alert ──────────────────────────────────────────────────── */}
      {!homeLoading && homeData?.burnout && (
        <div className="rounded-2xl bg-orange-500/10 border border-orange-500/20 p-4 flex items-start gap-3">
          <Flame className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            <span className="text-orange-300 font-semibold">Overplayed: </span>
            &quot;{homeData.burnout.trackName}&quot; by {homeData.burnout.artistName} is {homeData.burnout.pct}% of your recent listening.
          </p>
        </div>
      )}

    </div>
  );
}
