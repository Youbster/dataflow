"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Sparkles, Flame,
  Loader2, ExternalLink, Heart, Check, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { PlayOnSpotify } from "@/components/shared/play-on-spotify";

// ─── Mood config ────────────────────────────────────────────────────────────
const MOODS = [
  { id: "uplift",    emoji: "🚀", label: "Uplift",      gradient: "from-amber-500/20 to-amber-900/40",    border: "border-amber-700/30 hover:border-amber-400/60"    },
  { id: "focus",     emoji: "🎯", label: "Deep Focus",  gradient: "from-blue-500/20 to-blue-900/40",      border: "border-blue-700/30 hover:border-blue-400/60"      },
  { id: "gym",       emoji: "💪", label: "Workout",     gradient: "from-red-500/20 to-red-900/40",        border: "border-red-700/30 hover:border-red-400/60"        },
  { id: "unwind",    emoji: "🌊", label: "Unwind",      gradient: "from-teal-500/20 to-teal-900/40",      border: "border-teal-700/30 hover:border-teal-400/60"      },
  { id: "sad",       emoji: "🌧️", label: "Feel It",     gradient: "from-indigo-500/20 to-indigo-900/40",  border: "border-indigo-700/30 hover:border-indigo-400/60"  },
  { id: "party",     emoji: "🎉", label: "Party",       gradient: "from-pink-500/20 to-pink-900/40",      border: "border-pink-700/30 hover:border-pink-400/60"      },
  { id: "throwback", emoji: "⏪", label: "Throwback",   gradient: "from-violet-500/20 to-violet-900/40",  border: "border-violet-700/30 hover:border-violet-400/60"  },
  { id: "surprise",  emoji: "✨", label: "Surprise Me", gradient: "from-emerald-500/20 to-emerald-900/40", border: "border-emerald-700/30 hover:border-emerald-400/60" },
];

const SECTION_META = {
  anchor:    { label: "Setting the tone",    color: "text-primary",     bg: "bg-primary/15",    dot: "bg-primary"     },
  groove:    { label: "Finding your groove", color: "text-orange-400",  bg: "bg-orange-500/15", dot: "bg-orange-400"  },
  discovery: { label: "This one's for you",  color: "text-emerald-400", bg: "bg-emerald-500/15",dot: "bg-emerald-400" },
};

// ─── Types ───────────────────────────────────────────────────────────────────
type MoodPhase = "pick" | "loading" | "result";

interface MoodTrack {
  trackName: string;
  artistName: string;
  section: "anchor" | "groove" | "discovery";
  reason: string;
  spotifyTrackId?: string | null;
  spotifyUri?: string | null;
  albumImageUrl?: string | null;
}

interface MoodPlaylist {
  intro: string;
  tracks: MoodTrack[];
  playlistId?: string | null;
}

interface HomeData {
  stats: {
    playsThisWeek: number;
    estimatedMinutes: number;
    uniqueArtists: number;
    topGenre: string | null;
  };
  recentTopTracks: {
    spotifyTrackId: string;
    trackName: string;
    artistName: string;
    albumImageUrl: string | null;
    playCount: number;
  }[];
  vibe: { word: string; sentence: string } | null;
  burnout: { trackName: string; artistName: string; pct: number } | null;
}

// ─── Pill button helper ───────────────────────────────────────────────────────
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

// ─── Component ───────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [homeData, setHomeData]     = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [syncing, setSyncing]       = useState(false);

  // mood
  const [moodPhase, setMoodPhase]       = useState<MoodPhase>("pick");
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [intensity, setIntensity]       = useState<"low" | "medium" | "high">("medium");
  const [sessionMins, setSessionMins]   = useState<20 | 60 | 120>(60);
  const [familiarity, setFamiliarity]   = useState<"familiar" | "mix" | "fresh">("mix");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [environment, setEnvironment]   = useState<string | null>(null);
  const [startingPoint, setStartingPoint] = useState<"low" | "neutral" | "flow">("neutral");
  const [vocalPref, setVocalPref]       = useState<"any" | "instrumental">("any");
  const [language, setLanguage]         = useState<"any" | "english" | "other">("any");
  const [moodPlaylist, setMoodPlaylist] = useState<MoodPlaylist | null>(null);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [savedToSpotify, setSavedToSpotify] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);

  useEffect(() => {
    syncThenLoad();
  }, []);

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

  async function generateMoodPlaylist(overrideMood?: string) {
    const mood = overrideMood ?? selectedMood;
    if (!mood) return;
    setMoodPhase("loading");
    try {
      const res = await fetch("/api/ai/mood-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood, intensity, sessionMinutes: sessionMins, environment, startingPoint, familiarity, vocalPref, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMoodPlaylist(data);
      setMoodPhase("result");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate playlist");
      setMoodPhase("pick");
    }
  }

  function resetMood() {
    setMoodPhase("pick");
    setSelectedMood(null);
    setMoodPlaylist(null);
    setFeedbackMode(false);
    setIntensity("medium");
    setSessionMins(60);
    setFamiliarity("mix");
    setEnvironment(null);
    setStartingPoint("neutral");
    setVocalPref("any");
    setLanguage("any");
    setSavedToSpotify(false);
    setIsSaving(false);
    setShowAdvanced(false);
  }

  async function handleSaveToSpotify() {
    if (!moodPlaylist || isSaving || savedToSpotify) return;
    const playableUris = moodPlaylist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!);
    if (playableUris.length === 0) return;
    setIsSaving(true);
    try {
      const moodLabel = MOODS.find((m) => m.id === selectedMood)?.label ?? "Mood";
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: moodPlaylist.playlistId ?? null, name: `${moodLabel} — ${dateLabel}`, description: moodPlaylist.intro, trackUris: playableUris }),
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

  const activeMood = MOODS.find(m => m.id === selectedMood);

  return (
    <div className="space-y-5 md:space-y-8 max-w-4xl mx-auto">

      {/* ── Mood Section ───────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card">

        {/* ── PICK + CONFIGURE (unified) ──────────────────────────────────── */}
        {moodPhase === "pick" && (
          <div className="p-4 space-y-4">

            {/* Section label + sync */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold leading-tight">Generate a playlist</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {homeData?.vibe
                    ? `Your week has been ${homeData.vibe.word.toLowerCase()} — pick a mood to match`
                    : "Pick a mood and we'll build one for you"}
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

            {/* Compact mood grid — 4 cols, emoji + label only */}
            <div className="grid grid-cols-4 gap-2">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMood(m.id === selectedMood ? null : m.id)}
                  className={`relative rounded-2xl p-3 text-center border bg-gradient-to-br transition-all duration-150 active:scale-[0.95] ${m.gradient} ${
                    selectedMood === m.id
                      ? m.border.replace("hover:", "") + " ring-2 ring-white/20 scale-[1.04]"
                      : m.border
                  }`}
                >
                  <div className="text-xl leading-none mb-1">{m.emoji}</div>
                  <p className="font-semibold text-[11px] text-white leading-tight">{m.label}</p>
                </button>
              ))}
            </div>

            {/* Quick options — only shown once a mood is selected */}
            {selectedMood && (
              <div className="space-y-3 pt-1 border-t border-border/60">

                {/* Intensity */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Intensity</p>
                  <div className="flex gap-1.5">
                    <Pill active={intensity === "low"}    onClick={() => setIntensity("low")}>🌱 Low</Pill>
                    <Pill active={intensity === "medium"} onClick={() => setIntensity("medium")}>⚡ Medium</Pill>
                    <Pill active={intensity === "high"}   onClick={() => setIntensity("high")}>🔥 High</Pill>
                  </div>
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Duration</p>
                  <div className="flex gap-1.5">
                    <Pill active={sessionMins === 20}  onClick={() => setSessionMins(20)}>20 min</Pill>
                    <Pill active={sessionMins === 60}  onClick={() => setSessionMins(60)}>1 hour</Pill>
                    <Pill active={sessionMins === 120} onClick={() => setSessionMins(120)}>2 hr+</Pill>
                  </div>
                </div>

                {/* Familiarity */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Familiarity</p>
                  <div className="flex gap-1.5">
                    <Pill active={familiarity === "familiar"} onClick={() => setFamiliarity("familiar")}>🎵 Known</Pill>
                    <Pill active={familiarity === "mix"}      onClick={() => setFamiliarity("mix")}>🎲 Mix</Pill>
                    <Pill active={familiarity === "fresh"}    onClick={() => setFamiliarity("fresh")}>🌟 Fresh</Pill>
                  </div>
                </div>

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAdvanced ? "Less options" : "More options"}
                </button>

                {/* Advanced options */}
                {showAdvanced && (
                  <div className="space-y-3 pt-1">
                    {/* Environment */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Where?</p>
                      <div className="flex gap-1.5">
                        {[
                          { id: "headphones", label: "🎧" },
                          { id: "speaker",    label: "🔊" },
                          { id: "car",        label: "🚗" },
                          { id: "outside",    label: "🌳" },
                        ].map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setEnvironment(environment === e.id ? null : e.id)}
                            className={`flex-1 py-1.5 rounded-lg text-base border transition-all ${environment === e.id ? "border-primary bg-primary/20" : "border-border bg-accent/40"}`}
                          >
                            {e.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Starting point */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Starting from?</p>
                      <div className="flex gap-1.5">
                        <Pill active={startingPoint === "low"}     onClick={() => setStartingPoint("low")}>😔 Low</Pill>
                        <Pill active={startingPoint === "neutral"} onClick={() => setStartingPoint("neutral")}>😐 Ready</Pill>
                        <Pill active={startingPoint === "flow"}    onClick={() => setStartingPoint("flow")}>⚡ Flow</Pill>
                      </div>
                    </div>

                    {/* Vocals + Language */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Vocals</p>
                        <div className="flex gap-1.5">
                          <Pill active={vocalPref === "any"}          onClick={() => setVocalPref("any")}>🎤 Any</Pill>
                          <Pill active={vocalPref === "instrumental"} onClick={() => setVocalPref("instrumental")}>🎹 Instr.</Pill>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Language</p>
                        <div className="flex gap-1.5">
                          <Pill active={language === "any"}     onClick={() => setLanguage("any")}>🌍</Pill>
                          <Pill active={language === "english"} onClick={() => setLanguage("english")}>🇬🇧</Pill>
                          <Pill active={language === "other"}   onClick={() => setLanguage("other")}>🌐</Pill>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Generate button */}
                <Button
                  onClick={() => generateMoodPlaylist()}
                  className="w-full h-11 text-sm font-semibold"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Build my playlist
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── LOADING ─────────────────────────────────────────────────────── */}
        {moodPhase === "loading" && (
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

        {/* ── RESULT ──────────────────────────────────────────────────────── */}
        {moodPhase === "result" && moodPlaylist && activeMood && (
          <div className="p-5 space-y-5">
            {(() => {
              const playableUris = moodPlaylist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!);
              return (
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{activeMood.emoji}</span>
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{activeMood.label}</span>
                      <span className="text-muted-foreground/30 text-xs">·</span>
                      <span className="text-xs text-muted-foreground capitalize">{intensity}</span>
                      <span className="text-muted-foreground/30 text-xs">·</span>
                      <span className="text-xs text-muted-foreground">{sessionMins === 20 ? "20 min" : sessionMins === 60 ? "1 hr" : "2 hr+"}</span>
                    </div>
                    <p className="text-sm text-muted-foreground italic leading-relaxed">{moodPlaylist.intro}</p>
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
                      onClick={resetMood}
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
              const sectionTracks = moodPlaylist.tracks.filter(t => t.section === section);
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
                  {moodPlaylist.tracks.map((t, i) => (
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

      {/* ── Burnout Alert ───────────────────────────────────────────────────── */}
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
