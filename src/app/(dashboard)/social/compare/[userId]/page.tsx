"use client";

import { useState, useEffect, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Music } from "lucide-react";
import Link from "next/link";

interface CompareResult {
  targetUser: {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
  };
  similarityScore: number;
  compatibilityLabel: string;
  compatibilityDesc: string;
  sharedArtists: { artistName: string; imageUrl: string | null }[];
  myUniqueArtists: string[];
  theirUniqueArtists: string[];
  sharedGenres: string[];
  myTopGenres: string[];
  theirTopGenres: string[];
}

interface CurrentUser {
  displayName: string;
  avatarUrl: string | null;
}

// Score → ring color
function scoreColor(score: number) {
  if (score >= 60) return "#1DB954"; // green
  if (score >= 35) return "#f59e0b"; // amber
  return "#6b7280";                  // grey
}

// Score → ring SVG (half-filled circle feel via stroke-dasharray)
function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg className="absolute inset-0 -rotate-90" width="144" height="144" viewBox="0 0 144 144">
        {/* track */}
        <circle cx="72" cy="72" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/30" />
        {/* fill */}
        <circle
          cx="72" cy="72" r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center z-10">
        <p className="text-3xl font-bold leading-none" style={{ color }}>{score}%</p>
        <p className="text-[11px] text-muted-foreground mt-1">match</p>
      </div>
    </div>
  );
}

export default function ComparePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);

  const [result, setResult] = useState<CompareResult | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadComparison();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadComparison() {
    setLoading(true);
    setError(null);
    try {
      // Get current user's display info
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("display_name, avatar_url")
          .eq("id", user.id)
          .single();
        if (profile) {
          setMe({ displayName: profile.display_name, avatarUrl: profile.avatar_url });
        }
      }

      // Run comparison
      const res = await fetch("/api/social/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Comparison failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load comparison");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/social"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Social
      </Link>

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={loadComparison}
            className="mt-3 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Header — two users + score */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              {/* Me */}
              <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                <Avatar className="w-14 h-14 ring-2 ring-border">
                  <AvatarImage src={me?.avatarUrl ?? undefined} />
                  <AvatarFallback>{me?.displayName?.charAt(0) ?? "?"}</AvatarFallback>
                </Avatar>
                <p className="text-sm font-medium text-center truncate w-full">{me?.displayName ?? "You"}</p>
              </div>

              {/* Score ring */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <ScoreRing score={result.similarityScore} />
                <p className="text-xs font-semibold tracking-wide text-center" style={{ color: scoreColor(result.similarityScore) }}>
                  {result.compatibilityLabel}
                </p>
              </div>

              {/* Them */}
              <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                <Avatar className="w-14 h-14 ring-2 ring-border">
                  <AvatarImage src={result.targetUser.avatarUrl ?? undefined} />
                  <AvatarFallback>{result.targetUser.displayName.charAt(0)}</AvatarFallback>
                </Avatar>
                <p className="text-sm font-medium text-center truncate w-full">{result.targetUser.displayName}</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground text-center mt-5 leading-relaxed">
              {result.compatibilityDesc}
            </p>
          </div>

          {/* Shared artists */}
          {result.sharedArtists.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">You both love</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Artists you share in your top listening</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {result.sharedArtists.map((a) => (
                  <div key={a.artistName} className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5">
                    {a.imageUrl ? (
                      <img src={a.imageUrl} alt={a.artistName} className="w-5 h-5 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Music className="w-2.5 h-2.5 text-primary" />
                      </div>
                    )}
                    <span className="text-xs font-medium text-primary">{a.artistName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.sharedArtists.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-5 text-center">
              <p className="text-sm font-medium">No artists in common</p>
              <p className="text-xs text-muted-foreground mt-1">
                You're exploring completely different musical worlds.
              </p>
            </div>
          )}

          {/* Unique taste — two columns */}
          <div className="grid grid-cols-2 gap-4">
            {/* My unique */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Your sound</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Artists only you listen to</p>
              </div>
              {result.myUniqueArtists.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">All your artists are shared!</p>
              ) : (
                <div className="space-y-2">
                  {result.myUniqueArtists.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-sm truncate">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Their unique */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">{result.targetUser.displayName.split(" ")[0]}&apos;s sound</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Artists only they listen to</p>
              </div>
              {result.theirUniqueArtists.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">All their artists are shared!</p>
              ) : (
                <div className="space-y-2">
                  {result.theirUniqueArtists.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                      <span className="text-sm truncate">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Shared genres */}
          {result.sharedGenres.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Shared sounds</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Genres you both gravitate toward</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.sharedGenres.map((g) => (
                  <span
                    key={g}
                    className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 capitalize"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
