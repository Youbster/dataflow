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

// ─── Mood chips ───────────────────────────────────────────────────────────────
const MOOD_CHIPS = [
  { emoji: "⚡", label: "Energized" },
  { emoji: "🎯", label: "Focused"   },
  { emoji: "🌊", label: "Chill"     },
  { emoji: "✨", label: "Happy"     },
  { emoji: "🌧️", label: "Moody"     },
  { emoji: "🔥", label: "Confident" },
  { emoji: "💫", label: "Romantic"  },
  { emoji: "🕰️", label: "Nostalgic" },
];

// ─── Context chips — revealed progressively based on selected mood ────────────
const CONTEXT_BY_MOOD: Record<string, { emoji: string; label: string; prompt: string }[]> = {
  Energized: [
    { emoji: "🏋️", label: "Workout",     prompt: "High energy workout, pump it up, no slow moments" },
    { emoji: "🎉", label: "Party",       prompt: "Party energy, crowd pleasers, bangers only" },
    { emoji: "🚗", label: "Drive",       prompt: "Fast lane, windows down, open road feeling" },
    { emoji: "☕", label: "Morning",     prompt: "Morning boost, ease in then build energy" },
  ],
  Focused: [
    { emoji: "💻", label: "Deep work",   prompt: "Deep focus, no distractions, flow state" },
    { emoji: "📚", label: "Study",       prompt: "Studying, concentration, minimal lyrics" },
    { emoji: "📖", label: "Reading",     prompt: "Reading ambiance, calm and unobtrusive" },
    { emoji: "⌨️", label: "Coding",      prompt: "Coding session, rhythmic and focused, minimal lyrics" },
  ],
  Chill: [
    { emoji: "🌙", label: "Wind down",   prompt: "Winding down for the night, calm and relaxing" },
    { emoji: "🍳", label: "Cooking",     prompt: "Cooking at home, laid-back and easy" },
    { emoji: "🌃", label: "Night walk",  prompt: "Late night walk, atmospheric and introspective" },
    { emoji: "✈️", label: "Travel",      prompt: "Travelling, cinematic and wanderlust" },
  ],
  Happy: [
    { emoji: "💃", label: "Dance",       prompt: "Feel-good danceable tracks, pure joy" },
    { emoji: "🥂", label: "Brunch",      prompt: "Relaxed brunch vibes, good mood all the way" },
    { emoji: "🗺️", label: "Road trip",   prompt: "Road trip with friends, sing-along energy" },
    { emoji: "👥", label: "Friends",     prompt: "Hanging with friends, fun crowd-pleasing music" },
  ],
  Moody: [
    { emoji: "🌑", label: "Late night",  prompt: "Late night introspective, deep and atmospheric" },
    { emoji: "🌧️", label: "Rain",        prompt: "Rainy day vibes, melancholic and beautiful" },
    { emoji: "🪞", label: "Solo",        prompt: "Alone with my thoughts, emotional and raw" },
    { emoji: "✍️", label: "Journaling",  prompt: "Journaling session, reflective and quiet" },
  ],
  Confident: [
    { emoji: "💪", label: "Workout",     prompt: "Power workout, aggressive energy, no mercy" },
    { emoji: "👗", label: "Getting ready", prompt: "Getting ready to go out, hype and confident" },
    { emoji: "🌆", label: "Night out",   prompt: "Night out, swagger and confidence" },
    { emoji: "⚡", label: "Hustle",      prompt: "Hustle mode, driven and unstoppable" },
  ],
  Romantic: [
    { emoji: "🕯️", label: "Date night",  prompt: "Romantic date night, soft and intimate" },
    { emoji: "🌅", label: "Long drive",  prompt: "Long scenic drive, romantic and cinematic" },
    { emoji: "🫕", label: "Cooking together", prompt: "Cooking together, warm and loving" },
    { emoji: "🌙", label: "Night in",   prompt: "Cozy night in together, tender and close" },
  ],
  Nostalgic: [
    { emoji: "📼", label: "Throwback",   prompt: "Throwback hits, pure nostalgia" },
    { emoji: "☔", label: "Rainy day",   prompt: "Nostalgic rainy day, memories and feelings" },
    { emoji: "🚙", label: "Long drive",  prompt: "Long drive down memory lane" },
    { emoji: "🕯️", label: "Wind down",  prompt: "Nostalgic wind-down, soft and reflective" },
  ],
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase = "pick" | "loading" | "result";
type Vibe  = "familiar" | "mixed" | "fresh";

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
function Pill({
  active, onClick, children, violet = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  violet?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
        active
          ? violet
            ? "border-violet-500/50 bg-violet-500/20 text-violet-400"
            : "border-primary bg-primary/20 text-primary"
          : "border-border bg-accent/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── MoodChip ────────────────────────────────────────────────────────────────
function MoodChip({ emoji, label, active, onClick }: { emoji: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-accent/40 text-muted-foreground hover:text-foreground hover:border-border/80"
      }`}
    >
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [homeData, setHomeData]       = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [syncing, setSyncing]         = useState(false);

  // generator — core
  const [phase, setPhase]             = useState<Phase>("pick");
  const [promptText, setPromptText]   = useState("");
  const [selectedMood, setSelectedMood]       = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const [seedTrack, setSeedTrack]     = useState<RecentTrack | null>(null);
  const [playlist, setPlaylist]       = useState<GeneratedPlaylist | null>(null);
  const [generatedDiscovery, setGeneratedDiscovery] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [savedToSpotify, setSavedToSpotify] = useState(false);
  const [isSaving, setIsSaving]       = useState(false);

  // generator — always-visible controls
  const [intensity, setIntensity]     = useState<"low" | "mid" | "high">("mid");
  const [sessionMins, setSessionMins] = useState<20 | 60 | 120>(60);
  const [vibe, setVibe]               = useState<Vibe>("mixed");

  // generator — advanced
  const [showMore, setShowMore]       = useState(false);
  const [vocals, setVocals]           = useState<"any" | "lyrics" | "instrumental">("any");
  const [language, setLanguage]       = useState<"any" | "english" | "match">("any");
  const [genreLock, setGenreLock]     = useState("");
  const [artistLock, setArtistLock]   = useState("");

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

  // Smart suggestions — data-driven only, max 2
  const smartSuggestions = useMemo(() => {
    if (!homeData) return [];
    const out: string[] = [];
    if (homeData.topArtist && homeData.topGenres?.[0])
      out.push(`More ${homeData.topGenres[0]} like ${homeData.topArtist}`);
    else if (homeData.topArtist)
      out.push(`More music like ${homeData.topArtist}`);
    if (homeData.vibe?.word)
      out.push(`${homeData.vibe.word} — something I haven't heard yet`);
    if (homeData.burnout)
      out.push(`Something completely different — taking a break from "${homeData.burnout.trackName}"`);
    return out.slice(0, 2);
  }, [homeData]);

  // Context chips for the selected mood
  const contextChips = selectedMood ? (CONTEXT_BY_MOOD[selectedMood] ?? []) : [];

  // Build the combined prompt sent to Claude
  function buildPrompt(): string {
    const parts: string[] = [];
    if (promptText.trim()) parts.push(promptText.trim());
    if (selectedMood && selectedContext) {
      // Combine mood label + the rich contextual description from the chip
      const ctxChip = (CONTEXT_BY_MOOD[selectedMood] ?? []).find(c => c.label === selectedContext);
      const desc = ctxChip?.prompt ?? `${selectedMood} mood for ${selectedContext}`;
      parts.push(`${selectedMood} — ${desc}`);
    } else if (selectedMood) {
      parts.push(`${selectedMood} energy`);
    }
    return parts.join(" — ");
  }

  const canGenerate = vibe === "fresh" || promptText.trim().length > 0 || selectedMood !== null || seedTrack !== null;

  const hasAdvanced = vocals !== "any" || language !== "any" || genreLock.trim() !== "" || artistLock.trim() !== "";

  async function generate() {
    if (!canGenerate) return;
    setPhase("loading");
    setGeneratedDiscovery(vibe === "fresh");
    try {
      const res = await fetch("/api/ai/mood-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(),
          seedTrack: seedTrack ? { trackName: seedTrack.trackName, artistName: seedTrack.artistName } : null,
          sessionMinutes: sessionMins,
          familiarity: vibe,
          intensity,
          vocals,
          language,
          genreLock: genreLock.trim() || null,
          artistLock: artistLock.trim() || null,
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
    setSelectedMood(null);
    setSelectedContext(null);
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
        : seedTrack ? `Built around "${seedTrack.trackName}"`
        : buildPrompt().slice(0, 40) || "My Playlist";
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

  const firstName = homeData?.profile?.displayName?.split(" ")[0] ?? null;

  // Label shown in result header
  const resultLabel = generatedDiscovery
    ? null
    : seedTrack
    ? `Based on ${seedTrack.trackName}`
    : buildPrompt().slice(0, 50) || null;

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
            <img src={homeData.profile.avatarUrl} alt={homeData.profile.displayName} className="w-10 h-10 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold text-sm">{homeData.profile.displayName?.[0]?.toUpperCase() ?? "?"}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base leading-tight">Hey, {firstName ?? "there"}</p>
            {homeData.topGenres.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {homeData.topGenres.map((g, i) => (
                  <span key={g} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${GENRE_COLORS[i % GENRE_COLORS.length]}`}>{g}</span>
                ))}
              </div>
            )}
            {homeData.vibe?.sentence && (
              <p className="text-xs text-muted-foreground mt-1.5 italic leading-relaxed">{homeData.vibe.sentence}</p>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Generator card ─────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card">

        {/* ── PICK ─────────────────────────────────────────────────────────── */}
        {phase === "pick" && (
          <div className="p-4 space-y-5">

            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">What&apos;s the mood?</p>
              <button onClick={handleSync} disabled={syncing} title="Sync from Spotify" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 shrink-0">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* ── 1. Prompt ──────────────────────────────────────────────── */}
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                value={promptText}
                onChange={(e) => { setPromptText(e.target.value); if (e.target.value) setSeedTrack(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && canGenerate) { e.preventDefault(); generate(); } }}
                placeholder={selectedMood
                  ? `${selectedMood}${selectedContext ? ` for ${selectedContext}` : ""} — add more detail or just build it`
                  : "Describe the vibe you want…"}
                rows={2}
                className="w-full resize-none rounded-xl bg-accent/50 border border-border px-3.5 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
              />

              {/* Smart suggestion chips */}
              {!homeLoading && smartSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {smartSuggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setPromptText(s); setSeedTrack(null); }}
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
            </div>

            {/* ── 2. Mood grid ───────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Choose a mood</p>
              <div className="grid grid-cols-4 gap-1.5">
                {MOOD_CHIPS.map((chip) => (
                  <MoodChip
                    key={chip.label}
                    emoji={chip.emoji}
                    label={chip.label}
                    active={selectedMood === chip.label}
                    onClick={() => {
                      if (selectedMood === chip.label) {
                        setSelectedMood(null);
                        setSelectedContext(null);
                      } else {
                        setSelectedMood(chip.label);
                        setSelectedContext(null);
                      }
                    }}
                  />
                ))}
              </div>
            </div>

            {/* ── 3. Context (progressive reveal) ────────────────────────── */}
            {selectedMood && contextChips.length > 0 && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Make it for…
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {contextChips.map((chip) => (
                    <button
                      key={chip.label}
                      onClick={() => {
                        setSelectedContext(selectedContext === chip.label ? null : chip.label);
                        if (selectedContext !== chip.label) setSeedTrack(null);
                      }}
                      className={`flex flex-col items-center gap-1 px-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                        selectedContext === chip.label
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-accent/40 text-muted-foreground hover:text-foreground hover:border-border/80"
                      }`}
                    >
                      <span className="text-base leading-none">{chip.emoji}</span>
                      <span className="text-[10px] text-center leading-tight">{chip.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Seed from recent tracks ─────────────────────────────────── */}
            {!homeLoading && (homeData?.recentTopTracks.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border/40" />
                  <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest shrink-0">or start from a track</p>
                  <div className="flex-1 h-px bg-border/40" />
                </div>
                <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-none">
                  {homeData!.recentTopTracks.slice(0, 5).map((t) => {
                    const isSelected = seedTrack?.spotifyTrackId === t.spotifyTrackId;
                    return (
                      <button
                        key={t.spotifyTrackId}
                        onClick={() => { setSeedTrack(isSelected ? null : t); if (!isSelected) { setPromptText(""); setSelectedMood(null); setSelectedContext(null); } }}
                        className={`flex items-center gap-2 rounded-xl px-2.5 py-2 border shrink-0 transition-all ${isSelected ? "border-primary bg-primary/10" : "border-border bg-accent/40 hover:border-border/80 hover:bg-accent/60"}`}
                      >
                        {t.albumImageUrl && <img src={t.albumImageUrl} alt={t.trackName} className="w-7 h-7 rounded object-cover shrink-0" />}
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

            {homeLoading && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11 w-32 rounded-xl shrink-0" />)}
              </div>
            )}

            {/* ── 4. Fine-tune ────────────────────────────────────────────── */}
            <div className="space-y-3 pt-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Fine-tune</p>

              <div className="space-y-2.5">
                {/* Intensity */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground/60 w-14 shrink-0">Intensity</span>
                  <div className="flex gap-1.5 flex-1">
                    <Pill active={intensity === "low"}  onClick={() => setIntensity("low")}>Calm</Pill>
                    <Pill active={intensity === "mid"}  onClick={() => setIntensity("mid")}>Balanced</Pill>
                    <Pill active={intensity === "high"} onClick={() => setIntensity("high")}>Energetic</Pill>
                  </div>
                </div>

                {/* Duration */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground/60 w-14 shrink-0">Duration</span>
                  <div className="flex gap-1.5 flex-1">
                    <Pill active={sessionMins === 20}  onClick={() => setSessionMins(20)}>20 min</Pill>
                    <Pill active={sessionMins === 60}  onClick={() => setSessionMins(60)}>1 hour</Pill>
                    <Pill active={sessionMins === 120} onClick={() => setSessionMins(120)}>2 hr+</Pill>
                  </div>
                </div>

                {/* Discovery */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground/60 w-14 shrink-0">Discovery</span>
                  <div className="flex gap-1.5 flex-1">
                    <Pill active={vibe === "familiar"} onClick={() => setVibe("familiar")}>Familiar</Pill>
                    <Pill active={vibe === "mixed"}    onClick={() => setVibe("mixed")}>Mixed</Pill>
                    <Pill active={vibe === "fresh"} violet onClick={() => setVibe("fresh")}>
                      <span className="flex items-center justify-center gap-1"><Telescope className="w-3 h-3" />Fresh</span>
                    </Pill>
                  </div>
                </div>
              </div>
            </div>

            {/* ── More options ────────────────────────────────────────────── */}
            <button
              onClick={() => setShowMore(!showMore)}
              className={`flex items-center gap-1 text-[11px] transition-colors ${
                hasAdvanced ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}
            >
              {showMore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              More options{hasAdvanced && <span className="ml-0.5 text-primary/80">· customised</span>}
            </button>

            {showMore && (
              <div className="space-y-3 rounded-xl bg-accent/20 border border-border/50 px-3 py-3 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Vocals</p>
                  <div className="flex gap-1.5">
                    <Pill active={vocals === "any"} onClick={() => setVocals("any")}>Any</Pill>
                    <Pill active={vocals === "lyrics"} onClick={() => setVocals("lyrics")}>Lyrics</Pill>
                    <Pill active={vocals === "instrumental"} onClick={() => setVocals("instrumental")}>Instrumental</Pill>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Language</p>
                  <div className="flex gap-1.5">
                    <Pill active={language === "any"} onClick={() => setLanguage("any")}>Any</Pill>
                    <Pill active={language === "english"} onClick={() => setLanguage("english")}>English</Pill>
                    <Pill active={language === "match"} onClick={() => setLanguage("match")}>My taste</Pill>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Genre</p>
                  <input
                    type="text"
                    value={genreLock}
                    onChange={(e) => setGenreLock(e.target.value)}
                    placeholder="e.g. hip-hop, jazz, 90s rock…"
                    className="w-full rounded-lg bg-accent/50 border border-border px-3 py-1.5 text-xs placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Artist</p>
                  <input
                    type="text"
                    value={artistLock}
                    onChange={(e) => setArtistLock(e.target.value)}
                    placeholder="e.g. more like Frank Ocean, avoid Drake…"
                    className="w-full rounded-lg bg-accent/50 border border-border px-3 py-1.5 text-xs placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Generate */}
            <Button
              onClick={generate}
              disabled={!canGenerate}
              className={`w-full h-10 text-sm font-semibold transition-all ${
                vibe === "fresh" ? "bg-violet-600 hover:bg-violet-500 text-white" : ""
              }`}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {vibe === "fresh" ? "Discover music" : "Build this vibe"}
            </Button>

          </div>
        )}

        {/* ── LOADING ──────────────────────────────────────────────────────── */}
        {phase === "loading" && (
          <div className="p-12 flex flex-col items-center gap-4 text-center">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${generatedDiscovery ? "bg-violet-500/15" : "bg-primary/15"}`}>
              <Loader2 className={`w-7 h-7 animate-spin ${generatedDiscovery ? "text-violet-400" : "text-primary"}`} />
            </div>
            <div>
              <p className="font-bold text-lg">{generatedDiscovery ? "Hunting discoveries…" : "Building your vibe…"}</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                {generatedDiscovery
                  ? "Scanning your taste DNA for artists you've never heard"
                  : "Reading your taste, blocking overplayed songs, finding the right picks"}
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      {generatedDiscovery && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-violet-400 shrink-0">
                          <Telescope className="w-3 h-3" /> Discovery
                        </span>
                      )}
                      {resultLabel && !generatedDiscovery && (
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate max-w-[180px]">
                          &ldquo;{resultLabel.length > 50 ? resultLabel.slice(0, 50) + "…" : resultLabel}&rdquo;
                        </span>
                      )}
                      {seedTrack?.albumImageUrl && !generatedDiscovery && (
                        <img src={seedTrack.albumImageUrl} className="w-4 h-4 rounded shrink-0 object-cover" alt="" />
                      )}
                      <span className="text-muted-foreground/30 text-[10px] shrink-0">·</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{sessionMins === 20 ? "20 min" : sessionMins === 60 ? "1 hr" : "2 hr+"}</span>
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
                      <button onClick={reset} className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-accent/50 text-muted-foreground hover:text-foreground transition-colors">
                        New
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground italic leading-relaxed line-clamp-2">{playlist.intro}</p>
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
              <button onClick={() => setFeedbackMode(true)} className="w-full text-xs text-muted-foreground/50 hover:text-muted-foreground border border-dashed border-border/40 hover:border-border rounded-xl py-2 transition-all">
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
                <button onClick={() => setFeedbackMode(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Never mind</button>
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
