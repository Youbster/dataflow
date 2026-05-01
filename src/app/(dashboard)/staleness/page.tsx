"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SpotifyImage } from "@/components/shared/spotify-image";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  ExternalLink,
  Headphones,
  Flame,
  Clock,
  Music,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import type { StalenessResult, StalenessHealth } from "@/lib/staleness/types";
import { cn } from "@/lib/utils";

// ─── Constants ───────────────────────────────────────────────────────────────

const DISMISS_KEY = "staleness_dismissed";

const levelConfig = {
  burnt_out: {
    label: "Burnt Out",
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/20",
    bar: "bg-red-400",
    dot: "bg-red-400",
    badge: "bg-red-400/15 text-red-400 border border-red-400/25",
  },
  overplayed: {
    label: "Overplayed",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/20",
    bar: "bg-orange-400",
    dot: "bg-orange-400",
    badge: "bg-orange-400/15 text-orange-400 border border-orange-400/25",
  },
  familiar: {
    label: "Familiar",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/20",
    bar: "bg-yellow-400",
    dot: "bg-yellow-400",
    badge: "bg-yellow-400/15 text-yellow-400 border border-yellow-400/25",
  },
  fresh: {
    label: "Fresh",
    color: "text-green-400",
    bg: "bg-green-400/10",
    border: "border-green-400/20",
    bar: "bg-green-400",
    dot: "bg-green-400",
    badge: "bg-green-400/15 text-green-400 border border-green-400/25",
  },
};

const trendIcons = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  stable: Minus,
};

const GROUP_ORDER: StalenessResult["level"][] = [
  "burnt_out",
  "overplayed",
  "familiar",
];

const GROUP_LABELS: Record<string, string> = {
  burnt_out: "🔥 Burnt Out",
  overplayed: "⚠️ Overplayed",
  familiar: "🟡 Familiar",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function healthLabel(score: number): string {
  if (score >= 8) return "Excellent Variety";
  if (score >= 6) return "Good Mix";
  if (score >= 4) return "Getting Repetitive";
  if (score >= 2) return "Needs Fresh Air";
  return "Serious Burnout";
}

function healthColor(score: number): string {
  if (score >= 8) return "text-green-400";
  if (score >= 6) return "text-primary";
  if (score >= 4) return "text-yellow-400";
  if (score >= 2) return "text-orange-400";
  return "text-red-400";
}

function healthArcColor(score: number): string {
  if (score >= 8) return "#4ade80";
  if (score >= 6) return "#1db954";
  if (score >= 4) return "#facc15";
  if (score >= 2) return "#fb923c";
  return "#f87171";
}

function spotifySearchUrl(trackName: string, artistName: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${trackName} ${artistName}`)}`;
}

// ─── Health Score Arc ─────────────────────────────────────────────────────────

function HealthArc({ score }: { score: number }) {
  const radius = 52;
  const stroke = 8;
  const circumference = Math.PI * radius; // half-circle
  const pct = Math.max(0, Math.min(10, score)) / 10;
  const dashOffset = circumference * (1 - pct);
  const color = healthArcColor(score);

  return (
    <svg width="136" height="76" viewBox="0 0 136 76" className="overflow-visible">
      {/* Track */}
      <path
        d={`M ${stroke / 2} 68 A ${radius} ${radius} 0 0 1 ${136 - stroke / 2} 68`}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Fill */}
      <path
        d={`M ${stroke / 2} 68 A ${radius} ${radius} 0 0 1 ${136 - stroke / 2} 68`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        style={{ filter: `drop-shadow(0 0 6px ${color}80)`, transition: "stroke-dashoffset 1s ease" }}
      />
      {/* Score text */}
      <text x="68" y="60" textAnchor="middle" fill="white" fontSize="28" fontWeight="700" fontFamily="inherit">
        {score.toFixed(1)}
      </text>
      <text x="68" y="76" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="inherit">
        out of 10
      </text>
    </svg>
  );
}

// ─── Rest Ears Modal ──────────────────────────────────────────────────────────

interface RestTrack {
  trackName: string;
  artistName: string;
  reason: string;
  spotifyTrackId?: string;
  albumImageUrl?: string;
}

function RestEarsPanel({
  intro,
  tracks,
  onClose,
}: {
  intro: string;
  tracks: RestTrack[];
  onClose: () => void;
}) {
  return (
    <div className="glass-card rounded-2xl border border-white/[0.07] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Headphones className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Rest My Ears Playlist</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {intro && (
        <p className="text-sm text-muted-foreground italic border-l-2 border-primary/40 pl-3">
          {intro}
        </p>
      )}

      <div className="space-y-2">
        {tracks.map((track, i) => (
          <a
            key={i}
            href={
              track.spotifyTrackId
                ? `https://open.spotify.com/track/${track.spotifyTrackId}`
                : spotifySearchUrl(track.trackName, track.artistName)
            }
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.05] transition-colors group"
          >
            <span className="text-xs text-muted-foreground w-4 shrink-0 tabular-nums">
              {i + 1}
            </span>
            {track.albumImageUrl ? (
              <img
                src={track.albumImageUrl}
                alt={track.trackName}
                className="w-9 h-9 rounded-md object-cover shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Music className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                {track.trackName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {track.artistName}
              </p>
              {track.reason && (
                <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                  {track.reason}
                </p>
              )}
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Track Card ───────────────────────────────────────────────────────────────

interface SuggestionAlt {
  trackName: string;
  artistName: string;
  reason: string;
  spotifyTrackId?: string;
  albumImageUrl?: string;
}

function TrackCard({
  track,
  onDismiss,
}: {
  track: StalenessResult;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [alts, setAlts] = useState<SuggestionAlt[] | null>(null);
  const cfg = levelConfig[track.level];
  const TrendIcon = trendIcons[track.trend];

  async function loadAlternatives() {
    if (alts !== null || loadingAlts) return;
    setLoadingAlts(true);
    try {
      const res = await fetch("/api/ai/staleness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staleTracks: [
            {
              trackName: track.trackName,
              artistNames: track.artistNames,
              playCount: track.totalPlays,
              stalenessScore: track.stalenessScore,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const found: SuggestionAlt[] =
          data.suggestions?.[0]?.alternatives ?? [];
        setAlts(found);
      } else {
        setAlts([]);
        toast.error("Couldn't load alternatives");
      }
    } catch {
      setAlts([]);
      toast.error("Couldn't load alternatives");
    } finally {
      setLoadingAlts(false);
    }
  }

  function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next) loadAlternatives();
  }

  return (
    <div
      className={cn(
        "glass-card rounded-2xl border transition-all duration-200",
        cfg.border
      )}
    >
      <div className="p-4">
        <div className="flex items-center gap-3">
          {/* Album art */}
          <SpotifyImage
            src={track.albumImageUrl}
            alt={track.trackName}
            size="md"
          />

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{track.trackName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {track.artistNames.join(", ")}
                </p>
              </div>
              {/* Badges */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full",
                    cfg.badge
                  )}
                >
                  {cfg.label}
                </span>
                <TrendIcon
                  className={cn("w-3.5 h-3.5", cfg.color)}
                  strokeWidth={2}
                />
              </div>
            </div>

            {/* Staleness bar */}
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", cfg.bar)}
                  style={{ width: `${track.stalenessScore}%` }}
                />
              </div>
              <span className={cn("text-xs font-bold tabular-nums", cfg.color)}>
                {track.stalenessScore}
              </span>
            </div>

            {/* Why stale */}
            {track.whyStale && (
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                {track.whyStale}
              </p>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgo(track.lastPlayedAt)}
              </span>
              <span>{track.playsLast7Days}× this week</span>
              <span>{track.totalPlays} total</span>
            </div>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
          <button
            onClick={handleExpand}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            {loadingAlts ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {expanded ? "Hide alternatives" : "Find alternatives"}
            {!loadingAlts &&
              (expanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              ))}
          </button>

          <button
            onClick={() => onDismiss(track.spotifyTrackId)}
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Dismiss
          </button>
        </div>
      </div>

      {/* Alternatives panel */}
      {expanded && (
        <div className="px-4 pb-4">
          {loadingAlts && (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-12 rounded-xl" />
              ))}
            </div>
          )}

          {!loadingAlts && alts !== null && alts.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No verified alternatives found right now.
            </p>
          )}

          {!loadingAlts && alts && alts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-primary mb-2">
                Fresh alternatives:
              </p>
              {alts.map((alt, i) => (
                <a
                  key={i}
                  href={
                    alt.spotifyTrackId
                      ? `https://open.spotify.com/track/${alt.spotifyTrackId}`
                      : spotifySearchUrl(alt.trackName, alt.artistName)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.05] transition-colors group"
                >
                  {alt.albumImageUrl ? (
                    <img
                      src={alt.albumImageUrl}
                      alt={alt.trackName}
                      className="w-8 h-8 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <Music className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {alt.trackName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {alt.artistName}
                    </p>
                    {alt.reason && (
                      <p className="text-[11px] text-muted-foreground/60 truncate">
                        {alt.reason}
                      </p>
                    )}
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StalenessPage() {
  const [scores, setScores] = useState<StalenessResult[]>([]);
  const [health, setHealth] = useState<StalenessHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [restLoading, setRestLoading] = useState(false);
  const [restPlaylist, setRestPlaylist] = useState<{
    intro: string;
    tracks: RestTrack[];
  } | null>(null);

  // Load dismissed IDs from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    syncThenFetch();
  }, []);

  async function syncThenFetch() {
    try {
      await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
    } catch {
      // non-fatal
    }
    await fetchScores();
  }

  async function fetchScores() {
    try {
      const res = await fetch("/api/ai/staleness");
      if (res.ok) {
        const data = await res.json();
        setScores(data.scores ?? []);
        setHealth(data.health ?? null);
      }
    } catch {
      toast.error("Failed to load staleness data");
    } finally {
      setLoading(false);
    }
  }

  const handleDismiss = useCallback(
    (id: string) => {
      const next = new Set(dismissed);
      next.add(id);
      setDismissed(next);
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
    },
    [dismissed]
  );

  async function handleRestEars() {
    if (restLoading) return;
    setRestLoading(true);
    setRestPlaylist(null);
    try {
      const res = await fetch("/api/ai/rest-ears", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRestPlaylist(data);
      } else {
        toast.error("Couldn't generate playlist right now");
      }
    } catch {
      toast.error("Couldn't generate playlist right now");
    } finally {
      setRestLoading(false);
    }
  }

  // Visible scores — exclude fresh level and dismissed
  const visible = scores.filter(
    (s) => s.level !== "fresh" && !dismissed.has(s.spotifyTrackId)
  );

  const staleCount = scores.filter((s) => s.stalenessScore > 50).length;

  // Group by severity
  const groups = GROUP_ORDER.reduce<Record<string, StalenessResult[]>>(
    (acc, level) => {
      acc[level] = visible.filter((s) => s.level === level);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ear Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track overplayed songs and discover fresh alternatives.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-52 rounded-2xl" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : scores.length === 0 ? (
        <EmptyState
          title="No listening data yet"
          description="Come back after a few listening sessions — we'll show you which tracks you're wearing out and suggest fresh alternatives."
        />
      ) : (
        <>
          {/* ── Health Score Hero ── */}
          {health && (
            <div className="glass-card rounded-2xl border border-white/[0.07] p-6">
              <div className="flex items-start gap-6">
                {/* Arc gauge */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <HealthArc score={health.healthScore} />
                  <span
                    className={cn(
                      "text-xs font-semibold mt-1",
                      healthColor(health.healthScore)
                    )}
                  >
                    {healthLabel(health.healthScore)}
                  </span>
                </div>

                {/* Stats */}
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="text-sm font-semibold">Listening Variety</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {health.coverageNote}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/[0.04] rounded-xl p-3">
                      <p className="text-xs text-muted-foreground">
                        Top 3 concentration
                      </p>
                      <p
                        className={cn(
                          "text-lg font-bold tabular-nums",
                          health.topThreeConcentration > 60
                            ? "text-orange-400"
                            : health.topThreeConcentration > 40
                            ? "text-yellow-400"
                            : "text-primary"
                        )}
                      >
                        {health.topThreeConcentration}%
                      </p>
                      <p className="text-[10px] text-muted-foreground/60">
                        of 7-day plays
                      </p>
                    </div>
                    <div className="bg-white/[0.04] rounded-xl p-3">
                      <p className="text-xs text-muted-foreground">
                        Unique tracks
                      </p>
                      <p className="text-lg font-bold tabular-nums text-foreground">
                        {health.uniqueTracks}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60">
                        in your history
                      </p>
                    </div>
                  </div>

                  {/* Artist burnout warning */}
                  {health.artistBurnout && (
                    <div className="flex items-center gap-2 bg-orange-400/10 border border-orange-400/20 rounded-xl px-3 py-2">
                      <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                      <p className="text-xs text-orange-300">
                        <span className="font-semibold">
                          {health.artistBurnout.artistName}
                        </span>{" "}
                        is {health.artistBurnout.pct}% of your week —
                        artist burnout territory.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Rest my ears button */}
              <div className="mt-5 pt-4 border-t border-white/[0.05] flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {staleCount > 0
                      ? `${staleCount} track${staleCount !== 1 ? "s" : ""} need a break`
                      : "Your ears are fresh 🎧"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {staleCount > 0
                      ? "Let AI build you a playlist of everything else you love."
                      : "No overplayed tracks detected."}
                  </p>
                </div>
                {staleCount > 0 && (
                  <Button
                    onClick={handleRestEars}
                    disabled={restLoading}
                    className="shrink-0 gap-2"
                    size="sm"
                  >
                    {restLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Headphones className="w-3.5 h-3.5" />
                    )}
                    Rest My Ears
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ── Rest Ears Playlist ── */}
          {restPlaylist && (
            <RestEarsPanel
              intro={restPlaylist.intro}
              tracks={restPlaylist.tracks}
              onClose={() => setRestPlaylist(null)}
            />
          )}

          {/* ── Track Groups ── */}
          {visible.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="font-medium text-foreground">All clear 🎧</p>
              <p className="text-sm mt-1">
                No overplayed or familiar tracks right now.
              </p>
            </div>
          )}

          {GROUP_ORDER.map((level) => {
            const group = groups[level];
            if (!group || group.length === 0) return null;
            return (
              <section key={level} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground px-1">
                  {GROUP_LABELS[level]}{" "}
                  <span className="text-muted-foreground/50 font-normal">
                    ({group.length})
                  </span>
                </h2>
                <div className="space-y-2.5">
                  {group.map((track) => (
                    <TrackCard
                      key={track.spotifyTrackId}
                      track={track}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
