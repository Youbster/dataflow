"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Music, Share2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface WrappedData {
  monthName: string;
  stats: {
    totalPlays: number;
    uniqueTracks: number;
    uniqueArtists: number;
    estimatedMinutes: number;
    mostActiveDay: string;
    topGenres: string[];
  };
  topTrack: { trackName: string; artistName: string; playCount: number; albumImageUrl: string | null } | null;
  topArtist: { name: string; playCount: number; genres?: string[]; imageUrl?: string | null } | null;
  top5Tracks: { trackName: string; artistName: string; playCount: number; albumImageUrl: string | null }[];
  top5Artists: { name: string; playCount: number; genres: string[]; imageUrl: string | null }[];
  weekBreakdown: { week: number; plays: number; topTrack: string }[];
  ai: {
    monthWord: string;
    archetypeName: string;
    description: string;
    moodNarrative: string;
    standoutStat: string;
  };
}

const SLIDE_GRADIENTS = [
  "from-black via-zinc-900 to-black",
  "from-violet-950 via-purple-900 to-violet-950",
  "from-blue-950 via-blue-900 to-blue-950",
  "from-zinc-950 via-zinc-900 to-zinc-950",
  "from-emerald-950 via-green-900 to-emerald-950",
  "from-orange-950 via-amber-900 to-orange-950",
  "from-black via-zinc-900 to-black",
];

const ACCENT_COLORS = ["#1DB954","#a78bfa","#60a5fa","#4ade80","#1DB954","#fb923c","#1DB954"];

export default function WrappedPage() {
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const [animating, setAnimating] = useState(false);

  const totalSlides = 7;

  const goTo = useCallback((next: number, dir: "left" | "right") => {
    if (animating || next < 0 || next >= totalSlides) return;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => {
      setSlide(next);
      setAnimating(false);
    }, 320);
  }, [animating]);

  const next = useCallback(() => goTo(slide + 1, "right"), [slide, goTo]);
  const prev = useCallback(() => goTo(slide - 1, "left"), [slide, goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  async function generate() {
    setLoading(true);
    setSlide(0);
    try {
      const res = await fetch("/api/ai/wrapped", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
      setGenerated(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate Wrapped");
    } finally {
      setLoading(false);
    }
  }

  function share() {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied!");
  }

  const accent = ACCENT_COLORS[slide];

  if (!generated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 text-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center">
            <Music className="w-12 h-12 text-primary" />
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary animate-pulse" />
        </div>
        <div>
          <h1 className="text-4xl font-black tracking-tight">Monthly Wrapped</h1>
          <p className="text-muted-foreground mt-2 max-w-sm">
            Your music story for this month — top tracks, your listening personality, mood journey, and more.
          </p>
        </div>
        {loading ? (
          <div className="space-y-3 w-64">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-4/5 rounded-full mx-auto" />
            <p className="text-xs text-muted-foreground animate-pulse">Crafting your story…</p>
          </div>
        ) : (
          <Button size="lg" onClick={generate} className="gap-2 text-base px-8">
            <Music className="w-5 h-5" />
            Generate My {new Date().toLocaleString("default", { month: "long" })} Wrapped
          </Button>
        )}
      </div>
    );
  }

  if (!data) return null;

  const slides = [
    // 0 — Intro
    <div key="intro" className="flex flex-col items-center justify-center h-full gap-8 text-center px-8">
      <div className="space-y-2">
        <p className="text-sm font-medium tracking-[0.3em] uppercase" style={{ color: accent }}>
          DataFlow Wrapped
        </p>
        <h1 className="text-6xl sm:text-7xl font-black tracking-tight text-white leading-none">
          {data.monthName.split(" ")[0]}
        </h1>
        <p className="text-2xl font-light text-white/60">{data.monthName.split(" ")[1]}</p>
      </div>
      <div className="w-px h-16 bg-gradient-to-b from-white/0 via-white/30 to-white/0" />
      <p className="text-white/70 text-lg max-w-xs leading-relaxed">
        Here's what your music said about you this month.
      </p>
      <div className="flex flex-col items-center gap-1 mt-4">
        <p className="text-white/40 text-xs">Tap anywhere or press →</p>
      </div>
    </div>,

    // 1 — Top Artist
    <div key="artist" className="flex flex-col items-center justify-center h-full gap-6 text-center px-8">
      <p className="text-sm font-medium tracking-[0.3em] uppercase" style={{ color: accent }}>
        Your #1 Artist
      </p>
      {data.top5Artists[0]?.imageUrl && (
        <img
          src={data.top5Artists[0].imageUrl}
          alt={data.topArtist?.name}
          className="w-32 h-32 rounded-full object-cover ring-4"
          style={{ ringColor: accent }}
        />
      )}
      <div>
        <h2 className="text-5xl sm:text-6xl font-black text-white leading-none mb-3">
          {data.topArtist?.name ?? "—"}
        </h2>
        <p className="text-white/50 text-lg">
          {data.topArtist?.playCount ?? 0} plays this month
        </p>
        {data.top5Artists[0]?.genres.length > 0 && (
          <div className="flex gap-2 justify-center mt-3 flex-wrap">
            {data.top5Artists[0].genres.map((g) => (
              <span key={g} className="text-xs px-3 py-1 rounded-full bg-white/10 text-white/70">{g}</span>
            ))}
          </div>
        )}
      </div>
      <div className="w-full max-w-xs space-y-2 mt-2">
        {data.top5Artists.slice(1, 4).map((a, i) => (
          <div key={a.name} className="flex items-center gap-3 text-left">
            <span className="text-white/30 text-sm w-5 text-right">{i + 2}</span>
            <span className="text-white/80 text-sm font-medium">{a.name}</span>
            <span className="text-white/30 text-xs ml-auto">{a.playCount}×</span>
          </div>
        ))}
      </div>
    </div>,

    // 2 — Top Tracks
    <div key="tracks" className="flex flex-col items-center justify-center h-full gap-6 px-8 w-full max-w-md mx-auto">
      <p className="text-sm font-medium tracking-[0.3em] uppercase text-center" style={{ color: accent }}>
        Your Top Tracks
      </p>
      <div className="w-full space-y-4">
        {data.top5Tracks.map((t, i) => (
          <div key={t.trackName} className="flex items-center gap-4">
            <span
              className="text-4xl font-black tabular-nums leading-none shrink-0"
              style={{ color: i === 0 ? accent : "rgba(255,255,255,0.2)" }}
            >
              {i + 1}
            </span>
            {t.albumImageUrl && (
              <img src={t.albumImageUrl} alt={t.trackName} className="w-12 h-12 rounded-md object-cover shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`font-bold truncate ${i === 0 ? "text-white text-lg" : "text-white/80"}`}>
                {t.trackName}
              </p>
              <p className="text-white/40 text-sm truncate">{t.artistName}</p>
            </div>
            {t.playCount > 1 && (
              <span className="text-xs text-white/30 shrink-0">{t.playCount}×</span>
            )}
          </div>
        ))}
      </div>
    </div>,

    // 3 — Numbers
    <div key="numbers" className="flex flex-col items-center justify-center h-full gap-8 text-center px-8">
      <p className="text-sm font-medium tracking-[0.3em] uppercase" style={{ color: accent }}>
        By the Numbers
      </p>
      <div className="grid grid-cols-2 gap-6 w-full max-w-xs">
        {[
          { label: "Minutes", value: data.stats.estimatedMinutes.toLocaleString() },
          { label: "Plays", value: data.stats.totalPlays.toLocaleString() },
          { label: "Artists", value: data.stats.uniqueArtists.toLocaleString() },
          { label: "Tracks", value: data.stats.uniqueTracks.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-4xl font-black text-white">{value}</p>
            <p className="text-white/40 text-sm mt-1">{label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2 text-center">
        <p className="text-white/40 text-sm">Most active day</p>
        <p className="text-2xl font-bold text-white">{data.stats.mostActiveDay}</p>
      </div>
      {data.stats.topGenres.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {data.stats.topGenres.slice(0, 4).map((g) => (
            <span key={g} className="text-xs px-3 py-1.5 rounded-full bg-white/10 text-white/70">{g}</span>
          ))}
        </div>
      )}
      <p className="text-white/50 text-sm italic max-w-xs">{data.ai.standoutStat}</p>
    </div>,

    // 4 — Personality
    <div key="personality" className="flex flex-col items-center justify-center h-full gap-6 text-center px-8 max-w-md mx-auto">
      <p className="text-sm font-medium tracking-[0.3em] uppercase" style={{ color: accent }}>
        This Month You Were
      </p>
      <div>
        <p className="text-6xl sm:text-7xl font-black text-white leading-none mb-2">
          {data.ai.monthWord}
        </p>
        <p className="text-white/50 text-xl">{data.ai.archetypeName}</p>
      </div>
      <div className="w-px h-8 bg-gradient-to-b from-white/0 via-white/20 to-white/0" />
      <p className="text-white/80 text-base leading-relaxed">{data.ai.description}</p>
    </div>,

    // 5 — Mood Journey
    <div key="mood" className="flex flex-col items-center justify-center h-full gap-6 text-center px-8 max-w-md mx-auto">
      <p className="text-sm font-medium tracking-[0.3em] uppercase" style={{ color: accent }}>
        Your Month's Arc
      </p>
      <div className="w-full flex items-end justify-center gap-2 h-24">
        {data.weekBreakdown.map((w) => {
          const maxPlays = Math.max(...data.weekBreakdown.map((x) => x.plays), 1);
          const heightPct = Math.max(15, (w.plays / maxPlays) * 100);
          return (
            <div key={w.week} className="flex flex-col items-center gap-2 flex-1">
              <div
                className="w-full rounded-t-md transition-all"
                style={{ height: `${heightPct}%`, backgroundColor: accent, opacity: 0.7 + (w.plays / maxPlays) * 0.3 }}
              />
              <p className="text-white/40 text-xs">W{w.week}</p>
            </div>
          );
        })}
      </div>
      <p className="text-white/80 text-base leading-relaxed">{data.ai.moodNarrative}</p>
      {data.topTrack && (
        <div className="mt-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-center">
          <p className="text-white/40 text-xs mb-1">Track of the month</p>
          <p className="text-white font-bold">{data.topTrack.trackName}</p>
          <p className="text-white/50 text-sm">{data.topTrack.artistName} · {data.topTrack.playCount}×</p>
        </div>
      )}
    </div>,

    // 6 — Outro
    <div key="outro" className="flex flex-col items-center justify-center h-full gap-8 text-center px-8">
      <div className="space-y-2">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
          <Music className="w-8 h-8 text-primary" />
        </div>
        <p className="text-sm font-medium tracking-[0.3em] uppercase" style={{ color: accent }}>
          That was
        </p>
        <h2 className="text-5xl font-black text-white">{data.monthName}</h2>
      </div>
      <p className="text-white/50 max-w-xs leading-relaxed">
        See you next month with a new story. Keep listening.
      </p>
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="border-white/20 text-white hover:bg-white/10 gap-2"
          onClick={share}
        >
          <Share2 className="w-4 h-4" />
          Share
        </Button>
        <Button
          variant="outline"
          className="border-white/20 text-white hover:bg-white/10 gap-2"
          onClick={() => { setSlide(0); }}
        >
          <RotateCcw className="w-4 h-4" />
          Replay
        </Button>
      </div>
    </div>,
  ];

  return (
    <div className="-mx-6 -mt-6" style={{ height: "calc(100vh - 4rem)" }}>
      <div className={`relative h-full bg-gradient-to-br ${SLIDE_GRADIENTS[slide]} overflow-hidden transition-all duration-500`}>
        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-3">
          {Array.from({ length: totalSlides }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i, i > slide ? "right" : "left")}
              className="h-1 flex-1 rounded-full overflow-hidden bg-white/20 cursor-pointer"
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: i < slide ? "100%" : i === slide ? "100%" : "0%", backgroundColor: i <= slide ? "white" : "transparent" }}
              />
            </button>
          ))}
        </div>

        {/* Slide content */}
        <div
          className="h-full flex flex-col"
          style={{
            transform: animating ? `translateX(${direction === "right" ? "-4%" : "4%"})` : "translateX(0)",
            opacity: animating ? 0 : 1,
            transition: "transform 0.32s cubic-bezier(0.16,1,0.3,1), opacity 0.32s ease",
          }}
        >
          {slides[slide]}
        </div>

        {/* Tap zones */}
        {slide > 0 && (
          <button
            className="absolute left-0 top-8 bottom-0 w-1/3 z-10 flex items-center justify-start pl-3 opacity-0 hover:opacity-100 transition-opacity"
            onClick={prev}
          >
            <ChevronLeft className="w-8 h-8 text-white/60" />
          </button>
        )}
        {slide < totalSlides - 1 && (
          <button
            className="absolute right-0 top-8 bottom-0 w-2/3 z-10 flex items-center justify-end pr-3 opacity-0 hover:opacity-100 transition-opacity"
            onClick={next}
          >
            <ChevronRight className="w-8 h-8 text-white/60" />
          </button>
        )}
      </div>
    </div>
  );
}
