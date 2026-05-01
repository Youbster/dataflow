"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Loader2, Monitor, Smartphone, Speaker, Tv, Tablet, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

function DeviceIcon({ type, className }: { type: string; className?: string }) {
  const icons: Record<string, React.ElementType> = {
    Computer: Monitor,
    Smartphone: Smartphone,
    Speaker: Speaker,
    TV: Tv,
    Tablet: Tablet,
  };
  const Icon = icons[type] ?? Play;
  return <Icon className={className} />;
}

interface PlayOnSpotifyProps {
  uris: string[];
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export function PlayOnSpotify({
  uris,
  label = "Play Now",
  size = "sm",
  className,
}: PlayOnSpotifyProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "picking" | "playing">("idle");
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (status !== "picking") return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setStatus("idle");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [status]);

  async function fetchDevices(): Promise<SpotifyDevice[]> {
    const res = await fetch("/api/spotify/devices");
    if (!res.ok) return [];
    const data = await res.json();
    return data.devices ?? [];
  }

  async function play(deviceId?: string) {
    const res = await fetch("/api/spotify/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "play_uris", uris, device_id: deviceId }),
    });

    if (res.ok) {
      setStatus("playing");
      toast.success("Playing on Spotify 🎵");
      // Reset after 10s so button becomes pressable again
      setTimeout(() => setStatus("idle"), 10_000);
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.error === "premium_required") {
        toast.error("Spotify Premium required for remote playback");
      } else {
        toast.error("Couldn't start playback — is Spotify open?");
      }
      setStatus("idle");
    }
  }

  async function handleClick() {
    if (status !== "idle" || uris.length === 0) return;
    setStatus("loading");

    const devs = await fetchDevices();
    setDevices(devs);

    if (devs.length === 0) {
      toast.info("Open Spotify on any device first, then try again", {
        description: "Phone, computer, or smart speaker all work.",
      });
      setStatus("idle");
      return;
    }

    const active = devs.find((d) => d.is_active);

    if (active) {
      // Active device found — play immediately, no picker needed
      await play(active.id);
    } else if (devs.length === 1) {
      // Only one device — just use it
      await play(devs[0].id);
    } else {
      // Multiple inactive devices — let user pick
      setStatus("picking");
    }
  }

  const isSmall = size === "sm";

  return (
    <div className={cn("relative", className)} ref={pickerRef}>
      <button
        onClick={handleClick}
        disabled={status === "loading" || uris.length === 0}
        className={cn(
          "flex items-center gap-2 rounded-full font-semibold transition-all",
          isSmall ? "px-3.5 py-1.5 text-xs" : "px-5 py-2.5 text-sm",
          status === "playing"
            ? "bg-primary/15 text-primary border border-primary/30"
            : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        )}
      >
        {status === "loading" ? (
          <Loader2 className={cn("animate-spin", isSmall ? "w-3.5 h-3.5" : "w-4 h-4")} />
        ) : (
          <Play className={cn(isSmall ? "w-3.5 h-3.5" : "w-4 h-4")} />
        )}
        {status === "playing" ? "Playing…" : label}
        {status === "picking" && (
          <ChevronDown className={cn(isSmall ? "w-3 h-3" : "w-3.5 h-3.5")} />
        )}
      </button>

      {/* Device picker dropdown */}
      {status === "picking" && devices.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 z-50 min-w-[210px] glass-card rounded-xl border border-white/[0.08] p-1.5 shadow-xl">
          <p className="text-[10px] text-muted-foreground px-2.5 py-1.5 uppercase tracking-wider">
            Choose a device
          </p>
          {devices.map((device) => (
            <button
              key={device.id}
              onClick={() => {
                setStatus("loading");
                play(device.id);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left group"
            >
              <DeviceIcon
                type={device.type}
                className="w-3.5 h-3.5 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{device.name}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{device.type}</p>
              </div>
              {device.is_active && (
                <span className="text-[10px] text-primary font-medium shrink-0">Active</span>
              )}
            </button>
          ))}
          <div className="border-t border-white/[0.05] mt-1 pt-1">
            <button
              onClick={() => setStatus("idle")}
              className="w-full text-xs text-muted-foreground/50 hover:text-muted-foreground px-2.5 py-1.5 transition-colors text-left"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
