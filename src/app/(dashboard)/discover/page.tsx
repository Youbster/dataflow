"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, ResponsiveContainer, Cell,
} from "recharts";
import {
  Sparkles, RefreshCw, Search, Music, Clock, TrendingUp,
  Gem, ArrowRight, ChevronRight,
  Dna, Rewind, ChevronsUp, ChevronsDown, Minus,
  BarChart2,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoverProfile {
  archetype: { name: string; tagline: string; description: string; traits: string[] };
  listeningStory: string;
  evolutionNarrative: string;
  hiddenGemInsight: string;
}

interface HiddenGem {
  trackName: string;
  artistName: string;
  popularity: number;
  playCount: number;
  albumImageUrl: string | null;
  artistNames: string[];
}

interface PatternData {
  allHours: { hour: number; count: number }[];
  allDays: { day: string; count: number }[];
  peakHour: number;
  peakDay: string;
  totalPlays: number;
}

interface EvolutionData {
  shortTermArtists: { name: string; genres: string[] }[];
  longTermArtists: { name: string; genres: string[] }[];
  shortTermGenres: string[];
  longTermGenres: string[];
}

interface GenreDNAEntry {
  genre: string;
  thenPct: number;
  nowPct: number;
  delta: number;
}

interface MusicDNA {
  genreDNA: GenreDNAEntry[];
  newArrivals: string[];
  fadedAway: string[];
  loyal: string[];
  flashbackTracks: { trackName: string; artistName: string }[];
  narrative: string;
  shiftLabel: string;
}

interface FlashbackTrack {
  trackName: string;
  artistName: string;
  note: string;
}

interface HomeStats {
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
}

interface ArtistDive {
  artistName: string;
  hook: string;
  startingPoint: { trackName: string; reason: string };
  essentials: { trackName: string; note: string }[];
  deepCuts: { trackName: string; note: string }[];
  bestAlbum: { albumName: string; reason: string };
  vibe: string;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T };
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // storage may be full — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timeLabel = (h: number) =>
  h < 6 ? "Late Night" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : h < 22 ? "Evening" : "Night";

const hourLabel = (h: number) => {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
};

function gemPopularityLabel(popularity: number): string {
  if (popularity < 30) return "Underground gem";
  if (popularity < 50) return "Under the radar";
  return "Semi-known";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DiscoverPage() {
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [homeStatsLoading, setHomeStatsLoading] = useState(true);
  const [profile, setProfile] = useState<DiscoverProfile | null>(null);
  const [hiddenGems, setHiddenGems] = useState<HiddenGem[]>([]);
  const [patterns, setPatterns] = useState<PatternData | null>(null);
  const [evolution, setEvolution] = useState<EvolutionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [artistDive, setArtistDive] = useState<ArtistDive | null>(null);
  const [diveLoading, setDiveLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [dna, setDna] = useState<MusicDNA | null>(null);
  const [dnaLoading, setDnaLoading] = useState(true);
  const [flashback, setFlashback] = useState<FlashbackTrack[] | null>(null);
  const [flashbackLoading, setFlashbackLoading] = useState(false);

  // On mount: restore caches or auto-fetch
  useEffect(() => {
    // --- Home stats ---
    loadHomeStats();

    // --- Discover cache ---
    const cachedDiscover = loadCache<{
      profile: DiscoverProfile;
      hiddenGems: HiddenGem[];
      patterns: PatternData;
      evolution: EvolutionData;
    }>("df_discover_v1");

    if (cachedDiscover) {
      setProfile(cachedDiscover.profile);
      setHiddenGems(cachedDiscover.hiddenGems);
      setPatterns(cachedDiscover.patterns);
      setEvolution(cachedDiscover.evolution);
      setGenerated(true);
    } else {
      // Auto-generate on first visit (stale or empty cache)
      generate();
    }

    // --- DNA cache ---
    const cachedDna = loadCache<MusicDNA>("df_dna_v1");
    if (cachedDna) {
      setDna(cachedDna);
      setDnaLoading(false);
    } else {
      loadDna();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHomeStats() {
    setHomeStatsLoading(true);
    try {
      const res = await fetch("/api/ai/home");
      if (res.ok) setHomeStats(await res.json());
    } catch { /* silent */ }
    finally { setHomeStatsLoading(false); }
  }

  async function loadDna() {
    setDnaLoading(true);
    try {
      const res = await fetch("/api/ai/music-dna");
      if (res.ok) {
        const data: MusicDNA = await res.json();
        setDna(data);
        saveCache("df_dna_v1", data);
      }
    } catch { /* silent */ }
    finally { setDnaLoading(false); }
  }

  async function generateFlashback() {
    setFlashbackLoading(true);
    setFlashback(null);
    try {
      const res = await fetch("/api/ai/flashback", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFlashback(data.tracks);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate flashback");
    } finally {
      setFlashbackLoading(false);
    }
  }

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/discover", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProfile(data.profile);
      setHiddenGems(data.hiddenGems);
      setPatterns(data.patterns);
      setEvolution(data.evolution);
      setGenerated(true);
      saveCache("df_discover_v1", {
        profile: data.profile,
        hiddenGems: data.hiddenGems,
        patterns: data.patterns,
        evolution: data.evolution,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate story");
    } finally {
      setLoading(false);
    }
  }

  async function handleArtistDive() {
    if (!artistQuery.trim()) return;
    setDiveLoading(true);
    setArtistDive(null);
    try {
      const res = await fetch("/api/ai/artist-dive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistName: artistQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setArtistDive(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate guide");
    } finally {
      setDiveLoading(false);
    }
  }

  const maxHourCount = Math.max(...(patterns?.allHours.map((h) => h.count) ?? [1]));
  const maxDayCount = Math.max(...(patterns?.allDays.map((d) => d.count) ?? [1]));

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ------------------------------------------------------------------ */}
      {/* 1. Header                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered insights about who you are through music
          </p>
        </div>
        <Button onClick={generate} disabled={loading} className="gap-2">
          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {generated ? "Refresh Story" : "Generate My Story"}
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* 1b. Stats strip + recent top tracks                                */}
      {/* ------------------------------------------------------------------ */}
      {homeStatsLoading ? (
        <div className="space-y-3">
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl min-w-[110px] shrink-0" />
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        </div>
      ) : homeStats ? (
        <div className="space-y-4">
          {/* Stat strip */}
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible scrollbar-none">
            {[
              { label: "Plays this week", value: homeStats.stats.playsThisWeek, icon: BarChart2 },
              { label: "Minutes",         value: homeStats.stats.estimatedMinutes.toLocaleString(), icon: Clock },
              { label: "Artists",         value: homeStats.stats.uniqueArtists, icon: Music },
              { label: "Top genre",       value: homeStats.stats.topGenre ?? "—", icon: TrendingUp },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl bg-card border border-border p-3.5 min-w-[110px] shrink-0 md:min-w-0 md:shrink">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-primary/60" />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                </div>
                <p className="text-xl font-bold truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* What you've been playing */}
          {homeStats.recentTopTracks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                What you&apos;ve been playing
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {homeStats.recentTopTracks.map((t, i) => (
                  <a
                    key={t.trackName}
                    href={`spotify:track:${t.spotifyTrackId}`}
                    className="flex items-center gap-3 rounded-xl bg-card border border-border p-2.5 hover:border-primary/40 hover:bg-accent/50 transition-colors group"
                  >
                    {t.albumImageUrl
                      ? <img src={t.albumImageUrl} alt={t.trackName} className="w-10 h-10 rounded-md object-cover shrink-0" />
                      : <div className="w-10 h-10 rounded-md bg-accent shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{t.trackName}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.artistName}</p>
                      {t.playCount > 1 && <p className="text-xs text-primary mt-0.5">{t.playCount}×</p>}
                    </div>
                    <span className="text-2xl font-black text-muted-foreground/10 shrink-0">{i + 1}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* 2. Loading skeletons                                                */}
      {/* ------------------------------------------------------------------ */}
      {loading && (
        <div className="space-y-6">
          <Skeleton className="h-52 rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 3. Empty state — only when nothing is generated yet and not loading */}
      {/* ------------------------------------------------------------------ */}
      {!generated && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">Discover who you are through music</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Get your music archetype, listening patterns, hidden gems, taste evolution,
                and a personalized artist exploration guide — all powered by AI.
              </p>
            </div>
            <Button onClick={generate} size="lg" className="mt-2 gap-2" disabled={loading}>
              <Sparkles className="w-4 h-4" />
              {loading ? "Generating..." : "Generate My Story"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Music Identity (archetype)                                       */}
      {/* ------------------------------------------------------------------ */}
      {profile && !loading && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                <Music className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-primary font-medium uppercase tracking-wider mb-1">
                  Your Music Archetype
                </p>
                <h2 className="text-2xl font-bold">{profile.archetype.name}</h2>
                <p className="text-muted-foreground italic mt-1">{profile.archetype.tagline}</p>
                <p className="text-sm mt-3 leading-relaxed">{profile.archetype.description}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  {profile.archetype.traits.map((trait) => (
                    <Badge key={trait} variant="secondary" className="text-xs">
                      {trait}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 5. Your Listening Habits + Hidden Gems (2-col grid)                */}
      {/* ------------------------------------------------------------------ */}
      {patterns && profile && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Listening Habits */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Your Listening Habits
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                When you actually reach for music during the week
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {profile.listeningStory}
              </p>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Hour of day · Peak: {hourLabel(patterns.peakHour)} ({timeLabel(patterns.peakHour)})
                </p>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={patterns.allHours} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {patterns.allHours.map((h) => (
                        <Cell
                          key={h.hour}
                          fill={h.hour === patterns.peakHour ? "#1DB954" : `rgba(29,185,84,${0.15 + 0.7 * (h.count / maxHourCount)})`}
                        />
                      ))}
                    </Bar>
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(v) => v % 6 === 0 ? hourLabel(v) : ""}
                      tick={{ fontSize: 9, fill: "#666" }}
                      tickLine={false}
                      axisLine={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Day of week · Peak: {patterns.peakDay}
                </p>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={patterns.allDays} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {patterns.allDays.map((d) => (
                        <Cell
                          key={d.day}
                          fill={d.day === patterns.peakDay.slice(0, 3) ? "#1DB954" : `rgba(29,185,84,${0.15 + 0.7 * (d.count / maxDayCount)})`}
                        />
                      ))}
                    </Bar>
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: "#666" }}
                      tickLine={false}
                      axisLine={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Hidden Gems */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Gem className="w-4 h-4 text-primary" />
                Hidden Gems
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Tracks you love that most people haven&apos;t discovered yet
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {profile.hiddenGemInsight}
              </p>
              {hiddenGems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Sync more data to discover your hidden gems
                </p>
              ) : (
                <div className="space-y-2">
                  {hiddenGems.map((gem) => (
                    <div key={gem.trackName} className="flex items-center gap-3">
                      {gem.albumImageUrl ? (
                        <img
                          src={gem.albumImageUrl}
                          alt={gem.trackName}
                          className="w-9 h-9 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded bg-muted shrink-0 flex items-center justify-center">
                          <Music className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{gem.trackName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {gem.artistNames.join(", ")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge
                          variant="outline"
                          className="text-xs border-primary/30 text-primary"
                        >
                          {gemPopularityLabel(gem.popularity)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. How Your Sound Has Changed (evolution)                           */}
      {/* ------------------------------------------------------------------ */}
      {evolution && profile && !loading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              How Your Sound Has Changed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {profile.evolutionNarrative}
            </p>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  All Time
                </p>
                <div className="space-y-1.5">
                  {evolution.longTermArtists.slice(0, 5).map((a) => (
                    <div key={a.name} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                      <span className="text-sm truncate">{a.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" />
                  Right Now
                </p>
                <div className="space-y-1.5">
                  {evolution.shortTermArtists.slice(0, 5).map((a) => {
                    const isNew = !evolution.longTermArtists.find((l) => l.name === a.name);
                    return (
                      <div key={a.name} className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isNew ? "bg-primary" : "bg-muted-foreground/40"}`} />
                        <span className={`text-sm truncate ${isNew ? "text-primary font-medium" : ""}`}>
                          {a.name}
                        </span>
                        {isNew && (
                          <Badge className="text-[10px] px-1 py-0 h-4 bg-primary/10 text-primary border-0">
                            new
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1 flex-wrap">
              {evolution.shortTermGenres
                .filter((g) => !evolution.longTermGenres.includes(g))
                .slice(0, 3)
                .map((g) => (
                  <Badge key={g} className="text-xs bg-primary/10 text-primary border-0">
                    +{g}
                  </Badge>
                ))}
              {evolution.longTermGenres
                .filter((g) => evolution.shortTermGenres.includes(g))
                .slice(0, 3)
                .map((g) => (
                  <Badge key={g} variant="outline" className="text-xs">
                    {g}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 7. Your Sound Shift (DNA) + Flashback — always auto-loads           */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Dna className="w-4 h-4 text-primary" />
            Your Sound Shift
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            See what genres and artists you&apos;ve gained, kept, or left behind
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {dnaLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !dna || (dna.genreDNA.length === 0 && dna.newArrivals.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Sync more listening data to see your musical evolution
            </p>
          ) : (
            <>
              {/* Shift label + narrative */}
              {dna.shiftLabel && (
                <div>
                  <p className="text-lg font-bold">{dna.shiftLabel}</p>
                  {dna.narrative && (
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{dna.narrative}</p>
                  )}
                </div>
              )}

              {/* Genre shift bars */}
              {dna.genreDNA.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Genre shift</p>
                  {dna.genreDNA.map((g) => (
                    <div key={g.genre} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium capitalize">{g.genre}</span>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span className="text-muted-foreground/60">{g.thenPct}% before</span>
                          <span className="font-medium text-foreground">{g.nowPct}% now</span>
                          {g.delta > 3 ? (
                            <span className="flex items-center text-emerald-400 font-medium">
                              <ChevronsUp className="w-3 h-3" />+{g.delta}%
                            </span>
                          ) : g.delta < -3 ? (
                            <span className="flex items-center text-rose-400 font-medium">
                              <ChevronsDown className="w-3 h-3" />{g.delta}%
                            </span>
                          ) : (
                            <span className="flex items-center text-muted-foreground">
                              <Minus className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                        {/* before bar (ghost) */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/20"
                          style={{ width: `${g.thenPct}%` }}
                        />
                        {/* now bar */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all"
                          style={{
                            width: `${g.nowPct}%`,
                            backgroundColor: g.delta > 3 ? "#1DB954" : g.delta < -3 ? "#f43f5e" : "#6b7280",
                            opacity: 0.85,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Artist evolution columns */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { label: "New arrivals", items: dna.newArrivals, color: "text-emerald-400", dot: "bg-emerald-400" },
                  { label: "Staying loyal", items: dna.loyal, color: "text-primary", dot: "bg-primary" },
                  { label: "Drifted away", items: dna.fadedAway, color: "text-rose-400", dot: "bg-rose-400" },
                ].map(({ label, items, color, dot }) => (
                  <div key={label}>
                    <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${color}`}>{label}</p>
                    <div className="space-y-1.5">
                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">—</p>
                      ) : items.map(name => (
                        <div key={name} className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                          <span className="text-xs truncate">{name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Flashback Playlist */}
              <div className="pt-1 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold">Flashback Playlist</p>
                    <p className="text-xs text-muted-foreground">
                      A playlist curated from who you used to be
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={generateFlashback}
                    disabled={flashbackLoading}
                    className="gap-1.5 shrink-0"
                  >
                    {flashbackLoading
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <Rewind className="w-3.5 h-3.5" />}
                    {flashback ? "Regenerate" : "Generate"}
                  </Button>
                </div>

                {flashbackLoading && (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)}
                  </div>
                )}

                {flashback && !flashbackLoading && (
                  <div className="space-y-3">
                    {flashback.map((t, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="text-muted-foreground/40 font-bold text-sm w-5 shrink-0 mt-0.5">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {t.trackName}
                            <span className="text-muted-foreground font-normal"> · {t.artistName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 italic">{t.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 8. Artist Deep Dive — always at bottom                             */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            Artist Deep Dive
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Enter any artist and get a personalized guide through their music tailored to your taste
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Frank Ocean, Radiohead, SZA..."
              value={artistQuery}
              onChange={(e) => setArtistQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleArtistDive()}
            />
            <Button onClick={handleArtistDive} disabled={diveLoading || !artistQuery.trim()} className="gap-1.5 shrink-0">
              {diveLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              Explore
            </Button>
          </div>

          {diveLoading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}

          {artistDive && !diveLoading && (
            <div className="space-y-4 pt-1">
              <p className="text-sm text-muted-foreground italic">{artistDive.hook}</p>
              <p className="text-sm leading-relaxed">{artistDive.vibe}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-primary uppercase tracking-wider mb-1">
                    Start Here
                  </p>
                  <p className="text-sm font-medium">{artistDive.startingPoint.trackName}</p>
                  <p className="text-xs text-muted-foreground mt-1">{artistDive.startingPoint.reason}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Best Album
                  </p>
                  <p className="text-sm font-medium">{artistDive.bestAlbum.albumName}</p>
                  <p className="text-xs text-muted-foreground mt-1">{artistDive.bestAlbum.reason}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Essentials
                </p>
                <div className="space-y-2">
                  {artistDive.essentials.map((t) => (
                    <div key={t.trackName} className="flex gap-2 text-sm">
                      <span className="text-primary shrink-0">→</span>
                      <span>
                        <span className="font-medium">{t.trackName}</span>
                        <span className="text-muted-foreground"> — {t.note}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Deep Cuts
                </p>
                <div className="space-y-2">
                  {artistDive.deepCuts.map((t) => (
                    <div key={t.trackName} className="flex gap-2 text-sm">
                      <Gem className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                      <span>
                        <span className="font-medium">{t.trackName}</span>
                        <span className="text-muted-foreground"> — {t.note}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
