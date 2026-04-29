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
  Gem, ArrowRight, ChevronRight, CloudRain, Flame, Zap,
} from "lucide-react";
import { toast } from "sonner";

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

interface VibeForecast {
  weekTheme: string;
  weeklyMood: string;
  weatherInsight: string;
  predictedGenres: string[];
  predictions: { trackName: string; artistName: string; reason: string }[];
}

interface WeatherData {
  city: string;
  country: string;
  tempC: number;
  condition: string;
  isRaining: boolean;
  humidity: number;
}

interface BurnoutData {
  trackName: string;
  artistName: string;
  playCount: number;
  pct: number;
  totalRecent: number;
  cleanser: {
    trackName: string;
    artistName: string;
    sharedDNA: string;
    freshElement: string;
    reasoning: string;
  };
  burnoutInsight: string;
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

const timeLabel = (h: number) =>
  h < 6 ? "Late Night" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : h < 22 ? "Evening" : "Night";

const hourLabel = (h: number) => {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
};

export default function DiscoverPage() {
  const [profile, setProfile] = useState<DiscoverProfile | null>(null);
  const [hiddenGems, setHiddenGems] = useState<HiddenGem[]>([]);
  const [patterns, setPatterns] = useState<PatternData | null>(null);
  const [evolution, setEvolution] = useState<EvolutionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [artistDive, setArtistDive] = useState<ArtistDive | null>(null);
  const [diveLoading, setDiveLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [forecast, setForecast] = useState<VibeForecast | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [burnout, setBurnout] = useState<BurnoutData | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastLoaded, setForecastLoaded] = useState(false);

  useEffect(() => { loadForecast(); }, []);

  async function loadForecast() {
    setForecastLoading(true);
    try {
      const res = await fetch("/api/ai/vibe-forecast", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForecast(data.forecast);
      setWeather(data.weather);
      setBurnout(data.burnout);
      setForecastLoaded(true);
    } catch {
      // Silently fail — forecast is non-critical
    } finally {
      setForecastLoading(false);
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your Music Story</h1>
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

      {/* Burnout Alert */}
      {forecastLoading && (
        <Skeleton className="h-32 rounded-xl" />
      )}
      {burnout && !forecastLoading && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
                <Flame className="w-5 h-5 text-orange-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">Burnout Alert</p>
                  <Badge variant="outline" className="border-orange-500/40 text-orange-400 text-xs">
                    {burnout.playCount}× in 3 days · {burnout.pct}% of your listening
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">"{burnout.trackName}"</span> by {burnout.artistName}
                </p>
                <p className="text-xs text-muted-foreground italic mt-1">{burnout.burnoutInsight}</p>
              </div>
            </div>
            <div className="rounded-lg border border-orange-500/20 bg-background p-4 space-y-2">
              <p className="text-xs font-medium text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" />
                Sonic Palate Cleanser
              </p>
              <p className="font-medium">{burnout.cleanser.trackName}
                <span className="text-muted-foreground font-normal"> · {burnout.cleanser.artistName}</span>
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{burnout.cleanser.reasoning}</p>
              <div className="flex gap-4 pt-1">
                <div>
                  <p className="text-xs text-muted-foreground">Shared DNA</p>
                  <p className="text-xs font-medium">{burnout.cleanser.sharedDNA}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Fresh twist</p>
                  <p className="text-xs font-medium">{burnout.cleanser.freshElement}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly Vibe Forecast */}
      {forecast && weather && !forecastLoading && (
        <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <CloudRain className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">Weekly Vibe Forecast</p>
                    <span className="text-xs text-muted-foreground">
                      {weather.city} · {weather.tempC}°C · {weather.condition}
                    </span>
                  </div>
                  <p className="text-xl font-bold mt-1">{forecast.weekTheme}</p>
                  <Badge variant="outline" className="mt-1 border-blue-500/30 text-blue-400 text-xs">
                    {forecast.weeklyMood}
                  </Badge>
                </div>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">{forecast.weatherInsight}</p>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                You'll crave this week
              </p>
              <div className="flex flex-wrap gap-1.5">
                {forecast.predictedGenres.map((g) => (
                  <Badge key={g} className="text-xs bg-blue-500/10 text-blue-400 border-0">{g}</Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Predicted obsessions
              </p>
              <div className="space-y-2.5">
                {forecast.predictions.map((p, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="text-blue-400 font-medium shrink-0 w-4">{i + 1}</span>
                    <div>
                      <span className="font-medium">{p.trackName}</span>
                      <span className="text-muted-foreground"> · {p.artistName}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
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
            <Button onClick={generate} size="lg" className="mt-2 gap-2">
              <Sparkles className="w-4 h-4" />
              Generate My Story
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading skeletons */}
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

      {/* Music Identity Card */}
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

      {/* Patterns + Hidden Gems */}
      {patterns && profile && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Listening Patterns */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                When You Listen
              </CardTitle>
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
                          {gem.popularity}% known
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

      {/* Taste Evolution */}
      {evolution && profile && !loading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Your Taste Journey
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

      {/* Artist Deep Dive — always visible */}
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
