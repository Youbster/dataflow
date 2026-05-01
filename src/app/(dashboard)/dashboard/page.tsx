"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Send, Sparkles, Gift, ListMusic, Flame,
  ArrowRight, Loader2, ExternalLink, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { PlayOnSpotify } from "@/components/shared/play-on-spotify";

// ─── Mood picker config ────────────────────────────────────────────────────
const MOODS = [
  { id: "uplift",    emoji: "🚀", label: "Uplift",      description: "Boost your energy",    gradient: "from-amber-500/20 to-amber-900/40",   border: "border-amber-700/30 hover:border-amber-400/60"   },
  { id: "focus",     emoji: "🎯", label: "Deep Focus",  description: "Lock in and flow",      gradient: "from-blue-500/20 to-blue-900/40",     border: "border-blue-700/30 hover:border-blue-400/60"     },
  { id: "gym",       emoji: "💪", label: "Workout",     description: "Push your limits",      gradient: "from-red-500/20 to-red-900/40",       border: "border-red-700/30 hover:border-red-400/60"       },
  { id: "unwind",    emoji: "🌊", label: "Unwind",      description: "Let it all go",         gradient: "from-teal-500/20 to-teal-900/40",     border: "border-teal-700/30 hover:border-teal-400/60"     },
  { id: "sad",       emoji: "🌧️", label: "Feel It",     description: "Sit with the feeling",  gradient: "from-indigo-500/20 to-indigo-900/40", border: "border-indigo-700/30 hover:border-indigo-400/60" },
  { id: "party",     emoji: "🎉", label: "Party",       description: "Turn it up",            gradient: "from-pink-500/20 to-pink-900/40",     border: "border-pink-700/30 hover:border-pink-400/60"     },
  { id: "throwback", emoji: "⏪", label: "Throwback",   description: "Go back in time",       gradient: "from-violet-500/20 to-violet-900/40", border: "border-violet-700/30 hover:border-violet-400/60" },
  { id: "surprise",  emoji: "✨", label: "Surprise Me", description: "I trust you",           gradient: "from-emerald-500/20 to-emerald-900/40", border: "border-emerald-700/30 hover:border-emerald-400/60" },
];

const SECTION_META = {
  anchor:    { label: "Setting the tone",    color: "text-primary",      bg: "bg-primary/15",       dot: "bg-primary"      },
  groove:    { label: "Finding your groove", color: "text-orange-400",   bg: "bg-orange-500/15",    dot: "bg-orange-400"   },
  discovery: { label: "This one's for you",  color: "text-emerald-400",  bg: "bg-emerald-500/15",   dot: "bg-emerald-400"  },
};

const EXAMPLES = [
  "What did I used to listen to a lot?",
  "Something for a late night drive",
  "Songs like Blinding Lights but darker",
  "A playlist for deep focus work",
  "Find me underrated gems in my genres",
  "Music for a Sunday morning",
];

// ─── Types ─────────────────────────────────────────────────────────────────
type MoodPhase = "pick" | "configure" | "loading" | "result";

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

interface PromptResult {
  type: "tracks" | "insight";
  message: string;
  tracks?: { trackName: string; artistName: string; reason: string }[];
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  // existing state
  const [homeData, setHomeData]       = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [syncing, setSyncing]         = useState(false);
  const [prompt, setPrompt]           = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptResult, setPromptResult]   = useState<PromptResult | null>(null);
  const [userName, setUserName]       = useState("");
  const [greeting, setGreeting]       = useState("Good morning");

  // mood state
  const [moodPhase, setMoodPhase]         = useState<MoodPhase>("pick");
  const [selectedMood, setSelectedMood]   = useState<string | null>(null);
  const [intensity, setIntensity]         = useState<"low" | "medium" | "high">("medium");
  const [sessionMins, setSessionMins]     = useState<20 | 60 | 120>(60);
  const [moodPlaylist, setMoodPlaylist]   = useState<MoodPlaylist | null>(null);
  const [feedbackMode, setFeedbackMode]   = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
    loadUser();
    syncThenLoad();
  }, []);

  async function loadUser() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const name = user?.user_metadata?.full_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "";
    setUserName(name);
  }

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
      if (res.ok) { toast.success("Synced from Spotify!"); await loadHome(); }
      else { const d = await res.json(); toast.error(d.error || "Sync failed"); }
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  }

  async function handlePrompt(text?: string) {
    const msg = (text ?? prompt).trim();
    if (!msg) return;
    if (text) setPrompt(text);
    setPromptLoading(true);
    setPromptResult(null);
    try {
      const res = await fetch("/api/ai/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromptResult(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally { setPromptLoading(false); }
  }

  async function generateMoodPlaylist() {
    if (!selectedMood) return;
    setMoodPhase("loading");
    try {
      const res = await fetch("/api/ai/mood-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: selectedMood, intensity, sessionMinutes: sessionMins }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMoodPlaylist(data);
      setMoodPhase("result");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate playlist");
      setMoodPhase("configure");
    }
  }

  function resetMood() {
    setMoodPhase("pick");
    setSelectedMood(null);
    setMoodPlaylist(null);
    setFeedbackMode(false);
    setIntensity("medium");
    setSessionMins(60);
  }

  const activeMood = MOODS.find(m => m.id === selectedMood);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}{userName ? `, ${userName}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Here&apos;s what your music says today.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </div>

      {/* ── Mood Section ───────────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card">

        {/* PICK */}
        {moodPhase === "pick" && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight">What do you need right now?</h2>
              {homeData?.vibe ? (
                <p className="text-sm text-muted-foreground mt-1">
                  Your week has been{" "}
                  <span className="text-foreground font-medium">{homeData.vibe.word.toLowerCase()}</span>
                  {" "}— let&apos;s meet you there
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  Pick a mood and we&apos;ll build a playlist from your taste — not a generic one
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMood(m.id); setMoodPhase("configure"); }}
                  className={`relative rounded-2xl p-4 text-left border bg-gradient-to-br transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] ${m.gradient} ${m.border}`}
                >
                  <div className="text-2xl mb-2">{m.emoji}</div>
                  <p className="font-semibold text-sm text-white">{m.label}</p>
                  <p className="text-xs text-white/50 mt-0.5 leading-tight">{m.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* CONFIGURE */}
        {moodPhase === "configure" && activeMood && (
          <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
              <button onClick={resetMood} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">Selected mood</p>
                <p className="font-bold text-lg leading-none">{activeMood.emoji} {activeMood.label}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">How intense?</p>
              <div className="flex gap-2">
                {(["low", "medium", "high"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setIntensity(lvl)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all capitalize ${
                      intensity === lvl
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border bg-accent/40 text-muted-foreground hover:text-foreground hover:border-border/80"
                    }`}
                  >
                    {lvl === "low" ? "🌱 Low" : lvl === "medium" ? "⚡ Medium" : "🔥 High"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">How long?</p>
              <div className="flex gap-2">
                {([20, 60, 120] as const).map((mins) => (
                  <button
                    key={mins}
                    onClick={() => setSessionMins(mins)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      sessionMins === mins
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border bg-accent/40 text-muted-foreground hover:text-foreground hover:border-border/80"
                    }`}
                  >
                    {mins === 20 ? "20 min" : mins === 60 ? "1 hour" : "2 hour+"}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={generateMoodPlaylist} className="w-full h-12 text-base font-semibold">
              <Sparkles className="w-4 h-4 mr-2" />
              Build my playlist
            </Button>
          </div>
        )}

        {/* LOADING */}
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

        {/* RESULT */}
        {moodPhase === "result" && moodPlaylist && activeMood && (
          <div className="p-6 space-y-6">
            {/* Header */}
            {(() => {
              const playableUris = moodPlaylist.tracks
                .filter((t) => t.spotifyUri)
                .map((t) => t.spotifyUri!);
              return (
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xl">{activeMood.emoji}</span>
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                        {activeMood.label}
                      </span>
                      <span className="text-muted-foreground/40 text-xs">·</span>
                      <span className="text-xs text-muted-foreground capitalize">{intensity} intensity</span>
                      <span className="text-muted-foreground/40 text-xs">·</span>
                      <span className="text-xs text-muted-foreground">
                        {sessionMins === 20 ? "20 min" : sessionMins === 60 ? "1 hr" : "2 hr+"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed italic">{moodPlaylist.intro}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {playableUris.length > 0 && (
                      <PlayOnSpotify uris={playableUris} label="Play All" />
                    )}
                    <button
                      onClick={resetMood}
                      className="text-xs px-3 py-1.5 rounded-full border border-border bg-accent/50 text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                    >
                      New vibe
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Track sections */}
            {(["anchor", "groove", "discovery"] as const).map((section) => {
              const sectionTracks = moodPlaylist.tracks.filter(t => t.section === section);
              if (!sectionTracks.length) return null;
              const meta = SECTION_META[section];
              return (
                <div key={section} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    <p className={`text-xs font-bold uppercase tracking-widest ${meta.color}`}>{meta.label}</p>
                  </div>
                  <div className="space-y-1.5">
                    {sectionTracks.map((t, i) => (
                      <a
                        key={i}
                        href={
                          t.spotifyTrackId
                            ? `https://open.spotify.com/track/${t.spotifyTrackId}`
                            : `https://open.spotify.com/search/${encodeURIComponent(`${t.trackName} ${t.artistName}`)}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl bg-accent/30 hover:bg-accent border border-transparent hover:border-border/60 p-3 transition-all group"
                      >
                        {t.albumImageUrl ? (
                          <img
                            src={t.albumImageUrl}
                            alt={t.trackName}
                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold ${meta.bg} ${meta.color}`}>
                            {i + 1}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm group-hover:text-primary transition-colors leading-snug">
                            {t.trackName}{" "}
                            <span className="text-muted-foreground font-normal">by {t.artistName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5 italic leading-relaxed">{t.reason}</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary shrink-0 transition-colors" />
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
                className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground border border-dashed border-border/50 hover:border-border rounded-xl py-2.5 transition-all"
              >
                Did anything break the vibe?
              </button>
            ) : (
              <div className="rounded-xl border border-border bg-accent/20 p-4 space-y-3">
                <p className="text-sm font-medium">Which track felt off?</p>
                <div className="flex flex-wrap gap-2">
                  {moodPlaylist.tracks.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        toast.success(`Got it — keeping "${t.trackName}" out of future ${activeMood.label} playlists`);
                        setFeedbackMode(false);
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-accent border border-border hover:border-red-500/50 hover:text-red-400 transition-colors"
                    >
                      {t.trackName}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setFeedbackMode(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Never mind
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Burnout Alert ──────────────────────────────────────────── */}
      {!homeLoading && homeData?.burnout && (
        <div className="rounded-2xl bg-orange-500/10 border border-orange-500/20 p-5 flex items-start gap-4">
          <div className="p-2 rounded-lg bg-orange-500/20 shrink-0">
            <Flame className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="font-semibold text-orange-300">Burnout Alert</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              You&apos;ve played{" "}
              <span className="text-foreground font-medium">&quot;{homeData.burnout.trackName}&quot;</span>{" "}
              by {homeData.burnout.artistName} for {homeData.burnout.pct}% of your recent listening. Your ears might need something fresh.
            </p>
          </div>
        </div>
      )}

      {/* ── AI Prompt ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="relative">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handlePrompt(); }}
            placeholder="Ask anything — a mood, a song, an artist, a vibe…"
            className="w-full bg-card border border-border rounded-2xl px-5 py-4 pr-14 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
          <button
            onClick={() => handlePrompt()}
            disabled={promptLoading || !prompt.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            {promptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => handlePrompt(ex)}
              disabled={promptLoading}
              className="text-xs px-3 py-1.5 rounded-full bg-accent text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors border border-border disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
        {(promptLoading || promptResult) && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            {promptLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : promptResult ? (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed">{promptResult.message}</p>
                {promptResult.tracks && promptResult.tracks.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-border">
                    {promptResult.tracks.map((t, i) => (
                      <a
                        key={i}
                        href={`https://open.spotify.com/search/${encodeURIComponent(`${t.trackName} ${t.artistName}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 rounded-xl bg-accent/40 hover:bg-accent border border-transparent hover:border-border p-3 transition-all group"
                      >
                        <span className="text-primary font-bold text-sm w-5 shrink-0 mt-0.5">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm group-hover:text-primary transition-colors">
                            {t.trackName}{" "}
                            <span className="text-muted-foreground font-normal">by {t.artistName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t.reason}</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
                      </a>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Vibe + Stats + Tracks ──────────────────────────────────── */}
      {homeLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-2xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        </div>
      ) : homeData ? (
        <>
          {homeData.vibe && (
            <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-6">
              <p className="text-xs text-primary font-medium tracking-widest uppercase mb-2">Your vibe this week</p>
              <p className="text-4xl font-black tracking-tight">{homeData.vibe.word}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{homeData.vibe.sentence}</p>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Plays this week",   value: homeData.stats.playsThisWeek },
              { label: "Minutes listened",  value: homeData.stats.estimatedMinutes.toLocaleString() },
              { label: "Artists explored",  value: homeData.stats.uniqueArtists },
              { label: "Top genre",         value: homeData.stats.topGenre ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl bg-card border border-border p-4">
                <p className="text-2xl font-bold truncate">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </div>
          {homeData.recentTopTracks.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What you&apos;ve been playing</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {homeData.recentTopTracks.map((t, i) => (
                  <a key={t.trackName} href={`spotify:track:${t.spotifyTrackId}`} className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3 hover:border-primary/40 hover:bg-accent/50 transition-colors group">
                    {t.albumImageUrl
                      ? <img src={t.albumImageUrl} alt={t.trackName} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      : <div className="w-12 h-12 rounded-lg bg-accent shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{t.trackName}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.artistName}</p>
                      {t.playCount > 1 && <p className="text-xs text-primary mt-0.5">{t.playCount}× this week</p>}
                    </div>
                    <span className="text-3xl font-black text-muted-foreground/15 shrink-0 leading-none">{i + 1}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* ── Explore ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Explore</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/wrapped" className="group rounded-2xl bg-gradient-to-br from-violet-950 to-violet-900 border border-violet-800/50 p-5 hover:border-violet-600 transition-all block">
            <Gift className="w-6 h-6 text-violet-400 mb-3" />
            <p className="font-semibold text-white">Monthly Wrapped</p>
            <p className="text-xs text-violet-300/60 mt-1">Your music story this month</p>
            <ArrowRight className="w-4 h-4 text-violet-400 mt-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link href="/discover" className="group rounded-2xl bg-gradient-to-br from-emerald-950 to-emerald-900 border border-emerald-800/50 p-5 hover:border-emerald-600 transition-all block">
            <Sparkles className="w-6 h-6 text-emerald-400 mb-3" />
            <p className="font-semibold text-white">Discover</p>
            <p className="text-xs text-emerald-300/60 mt-1">Your music identity & hidden gems</p>
            <ArrowRight className="w-4 h-4 text-emerald-400 mt-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link href="/playlists" className="group rounded-2xl bg-gradient-to-br from-blue-950 to-blue-900 border border-blue-800/50 p-5 hover:border-blue-600 transition-all block">
            <ListMusic className="w-6 h-6 text-blue-400 mb-3" />
            <p className="font-semibold text-white">AI Playlists</p>
            <p className="text-xs text-blue-300/60 mt-1">Generate a playlist from any mood</p>
            <ArrowRight className="w-4 h-4 text-blue-400 mt-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>

    </div>
  );
}
