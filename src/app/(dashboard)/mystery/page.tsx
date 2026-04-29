"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Check, Package, Flame, Trophy } from "lucide-react";
import { toast } from "sonner";

interface MysteryBox {
  id: string;
  track_name: string;
  artist_name: string;
  reason: string;
  is_golden: boolean;
  claimed: boolean;
  streak_count: number;
  date: string;
}

type Phase = "loading" | "idle" | "opening" | "burst" | "revealed";

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    function update() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const ms = midnight.getTime() - now.getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setTimeLeft(`${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return timeLeft;
}

export default function MysteryPage() {
  const [box, setBox] = useState<MysteryBox | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const countdown = useCountdown();

  useEffect(() => { fetchBox(); }, []);

  async function fetchBox() {
    try {
      const res = await fetch("/api/mystery");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBox(data);
      setClaimed(data.claimed);
      if (data.claimed) {
        // Already opened today — skip animation, go straight to revealed
        setPhase("revealed");
      } else {
        // Always show the box first so the animation can play
        setPhase("idle");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load Mystery Box");
      setPhase("idle");
    }
  }

  const open = useCallback(() => {
    if (phase !== "idle" || !box) return;
    setPhase("opening");
    setTimeout(() => setPhase("burst"), 700);
    setTimeout(() => setPhase("revealed"), 1050);
  }, [phase, box]);

  async function claim() {
    if (claiming || claimed) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/mystery/claim", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error);
      setClaimed(true);
      toast.success("Track claimed!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to claim");
    } finally {
      setClaiming(false);
    }
  }

  const isGolden = box?.is_golden ?? false;
  const streak = box?.streak_count ?? 1;
  const streakPosition = ((streak - 1) % 7) + 1;

  const boxStyle = isGolden
    ? { background: "linear-gradient(135deg, #92400e, #d97706, #fbbf24, #d97706, #92400e)", animation: "golden-pulse 2s ease-in-out infinite" }
    : { background: "linear-gradient(135deg, #1e1b4b, #4c1d95, #6d28d9, #4c1d95, #1e1b4b)" };

  return (
    <div className="flex flex-col items-center max-w-lg mx-auto min-h-[70vh] justify-center gap-8 py-8">

      {/* Header */}
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-black tracking-tight">
          {isGolden ? "✨ Golden Box" : "Mystery Box"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isGolden
            ? "Day 7 — your perfect undiscovered artist awaits"
            : "One track. Scary accurate. Changes at midnight."}
        </p>
      </div>

      {/* Streak bar */}
      {phase !== "loading" && box && (
        <div className="flex flex-col items-center gap-2 w-full">
          <div className="flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-medium">{streak}-day streak</span>
            {streak >= 7 && streak % 7 === 0 && (
              <span className="text-xs text-amber-400 font-medium">— Golden Box unlocked!</span>
            )}
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => {
              const filled = i < streakPosition;
              const isCurrentGolden = i === 6 && isGolden;
              return (
                <div
                  key={i}
                  className="w-8 h-2 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: isCurrentGolden
                      ? "#fbbf24"
                      : filled
                        ? "#1DB954"
                        : "rgba(255,255,255,0.1)",
                    boxShadow: filled ? (isCurrentGolden ? "0 0 8px #fbbf24" : "0 0 6px #1DB954") : "none",
                  }}
                />
              );
            })}
          </div>
          {streakPosition < 7 && (
            <p className="text-xs text-muted-foreground">
              {7 - streakPosition} day{7 - streakPosition !== 1 ? "s" : ""} until Golden Box
            </p>
          )}
        </div>
      )}

      {/* Main area */}
      {phase === "loading" && (
        <div className="flex flex-col items-center gap-4 w-full">
          <Skeleton className="w-56 h-56 rounded-3xl" />
          <Skeleton className="h-4 w-48" />
        </div>
      )}

      {/* Idle — box waiting */}
      {phase === "idle" && (
        <div className="flex flex-col items-center gap-6">
          <button
            onClick={open}
            className="relative w-52 h-52 rounded-3xl flex flex-col items-center justify-center gap-3 cursor-pointer group transition-transform hover:scale-105 active:scale-95"
            style={{ ...boxStyle, animation: `box-float 3s ease-in-out infinite${isGolden ? ", golden-pulse 2s ease-in-out infinite" : ""}` }}
          >
            <Package className="w-16 h-16 text-white/90" strokeWidth={1.5} />
            <span className="text-white/70 text-xs font-medium tracking-widest uppercase">
              Tap to reveal
            </span>
            {isGolden && (
              <div className="absolute -top-3 -right-3">
                <Trophy className="w-8 h-8 text-amber-400 drop-shadow-lg" />
              </div>
            )}
          </button>
          <p className="text-xs text-muted-foreground">Expires in {countdown}</p>
        </div>
      )}

      {/* Opening — shake */}
      {phase === "opening" && (
        <div
          className="w-52 h-52 rounded-3xl flex flex-col items-center justify-center gap-3"
          style={{ ...boxStyle, animation: "box-shake 0.7s ease-in-out" }}
        >
          <Package className="w-16 h-16 text-white/90" strokeWidth={1.5} />
        </div>
      )}

      {/* Burst — scale out */}
      {phase === "burst" && (
        <div
          className="w-52 h-52 rounded-3xl flex flex-col items-center justify-center"
          style={{ ...boxStyle, animation: "box-burst 0.35s ease-in forwards" }}
        >
          <Package className="w-16 h-16 text-white/90" strokeWidth={1.5} />
        </div>
      )}

      {/* Revealed — track card */}
      {phase === "revealed" && box && (
        <div
          className="w-full"
          style={{ animation: "reveal-in 0.5s cubic-bezier(0.16,1,0.3,1) forwards" }}
        >
          <div
            className="rounded-3xl p-8 flex flex-col items-center text-center gap-5"
            style={isGolden
              ? { background: "linear-gradient(135deg, #1c1008, #292010)", border: "1px solid rgba(251,191,36,0.4)" }
              : { background: "linear-gradient(135deg, #0f0a1e, #160d30)", border: "1px solid rgba(109,40,217,0.4)" }}
          >
            {isGolden && (
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                <span className="text-amber-400 text-xs font-bold tracking-widest uppercase">Golden Box — Day 7</span>
                <Trophy className="w-5 h-5 text-amber-400" />
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs text-white/40 uppercase tracking-widest">
                {isGolden ? "Your perfect undiscovered artist" : "Today's mystery"}
              </p>
              <h2 className="text-3xl font-black text-white leading-tight">{box.track_name}</h2>
              <p className="text-lg text-white/60 font-medium">{box.artist_name}</p>
            </div>

            <div
              className="w-12 h-px"
              style={{ background: isGolden ? "rgba(251,191,36,0.4)" : "rgba(109,40,217,0.5)" }}
            />

            <p className="text-sm text-white/70 leading-relaxed italic max-w-sm">
              {box.reason}
            </p>

            <div className="flex flex-col items-center gap-3 w-full pt-2">
              {claimed ? (
                <div className="flex items-center gap-2 text-emerald-400 font-medium">
                  <Check className="w-5 h-5" />
                  Claimed — saved to your history
                </div>
              ) : (
                <Button
                  onClick={claim}
                  disabled={claiming}
                  className="w-full"
                  style={isGolden
                    ? { background: "linear-gradient(90deg, #d97706, #fbbf24)", color: "#000" }
                    : {}}
                >
                  {claiming ? (
                    "Claiming…"
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-1.5" />
                      Claim this track
                    </>
                  )}
                </Button>
              )}
              <p className="text-xs text-white/30">
                {claimed ? `New box drops at midnight · ${countdown} left` : `Disappears in ${countdown}`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
