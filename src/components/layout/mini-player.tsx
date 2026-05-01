"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SkipBack, SkipForward, Play, Pause, Music } from "lucide-react";

interface PlaybackState {
  is_playing: boolean;
  progress_ms: number;
  item: {
    id: string;
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { name: string; images: { url: string }[] };
  } | null;
  device: { name: string; type: string } | null;
}

export function MiniPlayer() {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [localProgress, setLocalProgress] = useState(0);
  const [acting, setActing] = useState(false);
  const progressRef = useRef(0);
  const playingRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/player");
      // 401/403 = token scope issue — don't spam, just skip silently
      if (res.status === 401 || res.status === 403) {
        console.warn("[MiniPlayer] auth error", res.status, "— reconnect Spotify in Settings");
        return;
      }
      if (!res.ok) {
        console.warn("[MiniPlayer] API error:", res.status);
        return;
      }
      const data = await res.json();
      console.log("[MiniPlayer] state:", data?.item?.name ?? "nothing playing");
      setState(data as PlaybackState | null);
      if ((data as PlaybackState)?.progress_ms !== undefined) {
        progressRef.current = (data as PlaybackState).progress_ms;
        setLocalProgress((data as PlaybackState).progress_ms);
      }
      playingRef.current = (data as PlaybackState)?.is_playing ?? false;
    } catch (err) {
      console.warn("[MiniPlayer] fetch error:", err);
    }
  }, []);

  // Poll every 8 seconds
  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 8000);
    return () => clearInterval(id);
  }, [fetchState]);

  // Advance progress locally every second when playing
  useEffect(() => {
    const id = setInterval(() => {
      if (!playingRef.current) return;
      progressRef.current = Math.min(progressRef.current + 1000, state?.item?.duration_ms ?? 0);
      setLocalProgress(progressRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [state?.item?.duration_ms]);

  async function control(action: string) {
    if (acting) return;
    setActing(true);
    // Optimistic UI
    if (action === "pause") setState(s => s ? { ...s, is_playing: false } : s);
    if (action === "play") setState(s => s ? { ...s, is_playing: true } : s);
    playingRef.current = action === "play";
    try {
      await fetch("/api/spotify/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // Refresh state after a short delay so Spotify catches up
      setTimeout(fetchState, 800);
    } catch { /* silent */ }
    finally { setActing(false); }
  }

  if (!state?.item) return null;

  const { item, is_playing } = state;
  const duration = item.duration_ms;
  const pct = duration > 0 ? (localProgress / duration) * 100 : 0;
  const albumArt = item.album.images[0]?.url;
  const artist = item.artists.map(a => a.name).join(", ");

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div className="glass-miniplayer fixed bottom-0 left-0 right-0 md:left-60 z-50">
      {/* Progress bar */}
      <div className="h-[2px] bg-white/[0.06]">
        <div
          className="h-full bg-primary shadow-[0_0_8px_rgba(29,185,84,0.6)] transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Album art */}
        {albumArt ? (
          <img src={albumArt} alt={item.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
            <Music className="w-4 h-4 text-muted-foreground" />
          </div>
        )}

        {/* Track info */}
        <div className="min-w-0 flex-1">
          <a
            href={`spotify:track:${item.id}`}
            className="text-sm font-medium truncate block hover:text-primary transition-colors"
          >
            {item.name}
          </a>
          <p className="text-xs text-muted-foreground truncate">{artist}</p>
        </div>

        {/* Time */}
        <span className="text-xs text-muted-foreground tabular-nums hidden sm:block">
          {fmt(localProgress)} / {fmt(duration)}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => control("previous")}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => control(is_playing ? "pause" : "play")}
            className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
          >
            {is_playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            onClick={() => control("next")}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
