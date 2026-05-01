"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Sparkles, Flame,
  Loader2, ExternalLink, Heart, Check,
  ChevronDown, ChevronUp, Telescope,
} from "lucide-react";
import { toast } from "sonner";
import { PlayOnSpotify } from "@/components/shared/play-on-spotify";

// ─── Section labels ───────────────────────────────────────────────────────────
const SECTION_META = {
  anchor:    { label: "Setting the tone",    color: "text-primary",     bg: "bg-primary/15",    dot: "bg-primary"     },
  groove:    { label: "Finding your groove", color: "text-orange-400",  bg: "bg-orange-500/15", dot: "bg-orange-400"  },
  discovery: { label: "This one's for you",  color: "text-emerald-400", bg: "bg-emerald-500/15",dot: "bg-emerald-400" },
};

// ─── Genre chip colour palette ────────────────────────────────────────────────
const GENRE_COLORS = [
  "bg-violet-500/15 text-violet-400 border-violet-500/25",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "bg-orange-500/15 text-orange-400 border-orange-500/25",
  "bg-blue-500/15 text-blue-400 border-blue-500/25",
];

// ─── Activity / context chips ─────────────────────────────────────────────────
const ACTIVITY_CHIPS = [
  { emoji: "🏋️", label: "Workout",   prompt: "High energy workout, pump it up, no slow moments" },
  { emoji: "📚", label: "Focus",     prompt: "Deep focus, minimal lyrics, flow state, keep me locked in" },
  { emoji: "🚗", label: "Drive",     prompt: "Road trip vibes, windows down, open road feeling" },
  { emoji: "🌙", label: "Wind down", prompt: "Calm and relaxing, winding down for the night" },
  { emoji: "🎉", label: "Party",     prompt: "Party energy, crowd pleasers, danceable hits" },
  { emoji: "☕", label: "Morning",   prompt: "Easy morning, wake up gently, positive start to the day" },
  { emoji: "✈️", label: "Travel",    prompt: "Cinematic and wanderlust, perfect for being on the move" },
  { emoji: "😤", label: "Vent",      prompt: "Cathartic and emotional, help me process big feelings" },
];

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
  topGenres: string[];
  topArtist: string | null;
  profile: { displayName: string; avatarUrl: string | null } | null;
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

  // generator state
  const [phase, setPhase]               = useState<Phase>("pick");
  const [promptText, setPromptText]     = useState("");
  const [seedTrack, setSeedTrack]       = useState<RecentTrack | null>(null);
  const [sessionMins, setSessionMins]   = useState<20 | 60 | 120>(60);
  const [intensity, setIntensity]       = useState<"low" | "mid" | "high">("mid");
  const [discoveryMode, setDiscoveryMode] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [playlist, setPlaylist]         = useState<GeneratedPlaylist | null>(null);
  const [generatedDiscovery, setGeneratedDiscovery] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [savedToSpotify, setSavedToSpotify] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

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

  // Smart suggestion chips — built from actual Spotify data, never generic
  const smartSuggestions = useMemo(() => {
    if (!homeData) return [];
    const hour = new Date().getHours();
    const suggestions: string[] = [];

    if (homeData.topArtist && homeData.topGenres?.[0]) {
      suggestions.push(`More ${homeData.topGenres[0]} like ${homeData.topArtist}`);
    } else if (homeData.topArtist) {
      suggestions.push(`More music like ${homeData.topArtist}`);
    }

    if (homeData.vibe?.word) {
      suggestions.push(`${homeData.vibe.word} — something I haven't heard yet`);
    }

    const timeHint =
      hour >= 22 || hour < 5  ? "Late night — deep and atmospheric, something to disappear into" :
      hour < 11               ? "Easy morning, ease me into the day" :
      hour < 17               ? "Afternoon focus, keep the momentum going" :
                                "Evening unwind, the day is winding down";
    suggestions.push(timeHint);

    if (homeData.burnout) {
      suggestions.push(`Something completely different — need a break from "${homeData.burnout.trackName}"`);
    }

    return suggestions.slice(0, 3);
  }, [homeData]);

  const canGenerate = discoveryMode || promptText.trim().length > 0 || seedTrack !== null;

  async function generate() {
    if (!canGenerate) return;
    setPhase("loading");
    setGeneratedDiscovery(discoveryMode);
    try {
      const res = await fetch("/api/ai/mood-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptText.trim(),
          seedTrack: seedTrack ? { trackName: seedTrack.trackName, artistName: seedTrack.artistName } : null,
          sessionMinutes: sessionMins,
          familiarity: discoveryMode ? "fresh" : "mixed",
          intensity,
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
    setGeneratedDiscovery(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }

  async function handleSaveToSpotify() {
    if (!playlist || isSaving || savedToSpotify) return;
    const playableUris = playlist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!);
    if (playableUris.length === 0) return;
    setIsSaving(true);
    try {
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const label = generatedDiscovery
        ? `Discoveries — ${dateLabel}`
        : seedTrack
        ? `Built around "${seedTrack.trackName}"`
        : promptText.slice(0, 40) || "My Playlist";
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlist.playlistId ?? null, name: `${label} — ${dateLabel}`, description: playlist.intro, trackUris: playableUris }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "scope_missing") {
          toast.error("Spotify playlist access not granted", {
            description: "Reconnect your Spotify account in Settings to fix this.",
            action: { label: "Settings", onClick: () => router.push("/settings") },
            duration: 8000,
          });
        } else {
          throw new Error(data.error || "Failed to save");
        }
        return;
      }
      setSavedToSpotify(true);
      toast.success("Playlist saved to Spotify!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save to Spotify");
    } finally {
      setIsSaving(false);
    }
  }

  // ── First name from display name ───────────────────────────────────────────
  const firstName = homeData?.profile?.displayName?.split(" ")[0] ?? null;

  return (
    <div className="space-y-5 md:space-y-8 max-w-4xl mx-auto">

      {/* ── Personal section ───────────────────────────────────────────────── */}
      {homeLoading ? (
        <div className="flex items-center gap-3 px-1">
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-3 w-48 rounded" />
          </div>
        </div>
      ) : homeData?.profile ? (
        <div className="flex items-start gap-3 px-1">
          {homeData.profile.avatarUrl ? (
            <img
              src={homeData.profile.avatarUrl}
              alt={homeData.profile.displayName}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold text-sm">
                {homeData.profile.displayName?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base leading-tight">
              Hey, {firstName ?? "there"}
            </p>
            {homeData.topGenres.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {homeData.topGenres.map((g, i) => (
                  <span
                    key={g}
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${GENRE_COLORS[i % GENRE_COLORS.length]}`}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
            {homeData.vibe?.sentence && (
              <p className="text-xs text-muted-foreground mt-1.5 italic leading-relaxed">
                {homeData.vibe.sentence}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Generator ──────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card">

        {/* ── PICK ─────────────────────────────────────────────────────────── */}
        {phase === "pick" && (
          <div className="p-4 space-y-4">

            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Generate a playlist</p>
              <button
                onClick={handleSync}
                disabled={syncing}
                title="Sync from Spotify"
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Activity chips */}
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-0.5 scrollbar-none">
              {ACTIVITY_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => {
                    setPromptText(chip.prompt);
                    setSeedTrack(null);
                    textareaRef.current?.focus();
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shrink-0 transition-all ${
                    promptText === chip.prompt
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-accent/40 text-muted-foreground hover:text-foreground hover:border-border/80"
                  }`}
                >
                  <span>{chip.emoji}</span>
                  <span>{chip.label}</span>
                </button>
              ))}
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
              placeholder="Describe a vibe, activity, or feeling…"
              rows={2}
              className="w-full resize-none rounded-xl bg-accent/50 border border-border px-3.5 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
            />

            {/* Smart suggestion chips */}
            {!homeLoading && smartSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {smartSuggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setPromptText(s);
                      setSeedTrack(null);
                      textareaRef.current?.focus();
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      promptText === s
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border/60 bg-accent/30 text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

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

            {/* Customize toggle */}
            <button
              onClick={() => setShowCustomize(!showCustomize)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              {showCustomize ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Customize
            </button>

            {showCustomize && (
              <div className="space-y-3 rounded-xl bg-accent/20 border border-border/50 px-3 py-3">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Intensity</p>
                  <div className="flex gap-1.5">
                    <Pill active={intensity === "low"}  onClick={() => setIntensity("low")}>Calm</Pill>
                    <Pill active={intensity === "mid"}  onClick={() => setIntensity("mid")}>Balanced</Pill>
                    <Pill active={intensity === "high"} onClick={() => setIntensity("high")}>Energetic</Pill>
                  </div>
                </div>
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

            {/* Discovery mode toggle + Generate button */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDiscoveryMode(!discoveryMode)}
                title="Generate all tracks you've never heard before"
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold shrink-0 transition-all ${
                  discoveryMode
                    ? "border-violet-500/50 bg-violet-500/15 text-violet-400"
                    : "border-border bg-accent/30 text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
              >
                <Telescope className="w-3.5 h-3.5" />
                All new
              </button>
              <Button
                onClick={generate}
                disabled={!canGenerate}
                className={`flex-1 h-10 text-sm font-semibold transition-all ${
                  discoveryMode ? "bg-violet-600 hover:bg-violet-500 text-white" : ""
                }`}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {discoveryMode ? "Discover music" : "Build my playlist"}
              </Button>
            </div>

            {discoveryMode && (
              <p className="text-[11px] text-violet-400/70 text-center -mt-1">
                All tracks will be brand-new artists you&apos;ve never heard
              </p>
            )}

          </div>
        )}

        {/* ── LOADING ──────────────────────────────────────────────────────── */}
        {phase === "loading" && (
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${generatedDiscovery ? "bg-violet-500/15" : "bg-primary/15"}`}>
              <Loader2 className={`w-7 h-7 animate-spin ${generatedDiscovery ? "text-violet-400" : "text-primary"}`} />
            </div>
            <div>
              <p className="font-bold text-lg">
                {generatedDiscovery ? "Hunting discoveries…" : "Building your arc…"}
              </p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                {generatedDiscovery
                  ? "Scanning your taste DNA for artists you've never heard"
                  : "Reading your taste, blocking overplayed songs, finding the right discoveries"}
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
                <div className="space-y-2">
                  {/* Row 1: label + action buttons on the same line */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      {generatedDiscovery && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-violet-400 shrink-0">
                          <Telescope className="w-3 h-3" /> Discovery
                        </span>
                      )}
                      {!generatedDiscovery && seedTrack ? (
                        <>
                          {seedTrack.albumImageUrl && (
                            <img src={seedTrack.albumImageUrl} className="w-4 h-4 rounded shrink-0 object-cover" alt="" />
                          )}
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">
                            Based on {seedTrack.trackName}
                          </span>
                        </>
                      ) : !generatedDiscovery ? (
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate max-w-[160px]">
                          &ldquo;{promptText.length > 40 ? promptText.slice(0, 40) + "…" : promptText}&rdquo;
                        </span>
                      ) : null}
                      <span className="text-muted-foreground/30 text-[10px] shrink-0">·</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {sessionMins === 20 ? "20 min" : sessionMins === 60 ? "1 hr" : "2 hr+"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
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
                  {/* Row 2: intro — full width, clamped to 2 lines */}
                  <p className="text-xs text-muted-foreground italic leading-relaxed line-clamp-2">
                    {playlist.intro}
                  </p>
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
