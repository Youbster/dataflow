"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Send, Sparkles, Gift, ListMusic, Flame, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const EXAMPLES = [
  "What did I used to listen to a lot?",
  "Something for a late night drive",
  "Songs like Blinding Lights but darker",
  "A playlist for deep focus work",
  "Find me underrated gems in my genres",
  "Music for a Sunday morning",
];

interface HomeData {
  stats: {
    playsThisWeek: number;
    estimatedMinutes: number;
    uniqueArtists: number;
    topGenre: string | null;
  };
  recentTopTracks: {
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

export default function DashboardPage() {
  const [homeData, setHomeData] = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptResult, setPromptResult] = useState<PromptResult | null>(null);
  const [userName, setUserName] = useState("");

  useEffect(() => {
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
      await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
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
      const res = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (res.ok) {
        toast.success("Synced from Spotify!");
        await loadHome();
      } else {
        const d = await res.json();
        toast.error(d.error || "Sync failed");
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handlePrompt(text?: string) {
    const msg = (text ?? prompt).trim();
    if (!msg) return;
    if (text) setPrompt(text);
    setPromptLoading(true);
    setPromptResult(null);
    try {
      const res = await fetch("/api/ai/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromptResult(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPromptLoading(false);
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}{userName ? `, ${userName}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Here's what your music says today.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </div>

      {/* AI Prompt */}
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
            {promptLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />}
          </button>
        </div>

        {/* Example chips */}
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

        {/* Prompt result */}
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
                  <div className="space-y-3 pt-1 border-t border-border">
                    {promptResult.tracks.map((t, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="text-primary font-bold text-sm w-5 shrink-0 mt-0.5">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            {t.trackName}{" "}
                            <span className="text-muted-foreground font-normal">by {t.artistName}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Burnout Alert */}
      {!homeLoading && homeData?.burnout && (
        <div className="rounded-2xl bg-orange-500/10 border border-orange-500/20 p-5 flex items-start gap-4">
          <div className="p-2 rounded-lg bg-orange-500/20 shrink-0">
            <Flame className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="font-semibold text-orange-300">Burnout Alert</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              You've played{" "}
              <span className="text-foreground font-medium">"{homeData.burnout.trackName}"</span>{" "}
              by {homeData.burnout.artistName} for {homeData.burnout.pct}% of your recent listening. Your ears might need something fresh.
            </p>
          </div>
        </div>
      )}

      {/* Vibe + Stats + Tracks */}
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
          {/* Vibe hero */}
          {homeData.vibe && (
            <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-6">
              <p className="text-xs text-primary font-medium tracking-widest uppercase mb-2">Your vibe this week</p>
              <p className="text-4xl font-black tracking-tight">{homeData.vibe.word}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{homeData.vibe.sentence}</p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Plays this week", value: homeData.stats.playsThisWeek },
              { label: "Minutes listened", value: homeData.stats.estimatedMinutes.toLocaleString() },
              { label: "Artists explored", value: homeData.stats.uniqueArtists },
              { label: "Top genre", value: homeData.stats.topGenre ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl bg-card border border-border p-4">
                <p className="text-2xl font-bold truncate">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Recent top tracks */}
          {homeData.recentTopTracks.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What you've been playing</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {homeData.recentTopTracks.map((t, i) => (
                  <div key={t.trackName} className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3">
                    {t.albumImageUrl ? (
                      <img src={t.albumImageUrl} alt={t.trackName} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-accent shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{t.trackName}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.artistName}</p>
                      {t.playCount > 1 && (
                        <p className="text-xs text-primary mt-0.5">{t.playCount}× this week</p>
                      )}
                    </div>
                    <span className="text-3xl font-black text-muted-foreground/15 shrink-0 leading-none">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Quick entry points */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Explore</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/wrapped"
            className="group rounded-2xl bg-gradient-to-br from-violet-950 to-violet-900 border border-violet-800/50 p-5 hover:border-violet-600 transition-all block"
          >
            <Gift className="w-6 h-6 text-violet-400 mb-3" />
            <p className="font-semibold text-white">Monthly Wrapped</p>
            <p className="text-xs text-violet-300/60 mt-1">Your music story this month</p>
            <ArrowRight className="w-4 h-4 text-violet-400 mt-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            href="/discover"
            className="group rounded-2xl bg-gradient-to-br from-emerald-950 to-emerald-900 border border-emerald-800/50 p-5 hover:border-emerald-600 transition-all block"
          >
            <Sparkles className="w-6 h-6 text-emerald-400 mb-3" />
            <p className="font-semibold text-white">Discover</p>
            <p className="text-xs text-emerald-300/60 mt-1">Your music identity & hidden gems</p>
            <ArrowRight className="w-4 h-4 text-emerald-400 mt-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            href="/playlists"
            className="group rounded-2xl bg-gradient-to-br from-blue-950 to-blue-900 border border-blue-800/50 p-5 hover:border-blue-600 transition-all block"
          >
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
