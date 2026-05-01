"use client";

import { useState, useEffect } from "react";
import { Music } from "lucide-react";

/**
 * Full-screen branded splash that shows once on first dashboard mount.
 * Because the App Router layout is preserved during intra-app navigation,
 * this component only mounts once per session — no sessionStorage needed.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"enter" | "exit" | "done">("enter");

  useEffect(() => {
    // Hold → fade out → unmount
    const hold = setTimeout(() => {
      setPhase("exit");
      setTimeout(() => setPhase("done"), 320);
    }, 1200);
    return () => clearTimeout(hold);
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-background ${
        phase === "exit" ? "opacity-0 transition-opacity duration-300" : "opacity-100"
      }`}
    >
      <div className="animate-in fade-in zoom-in-95 duration-300 fill-mode-both flex flex-col items-center gap-5">
        {/* Same mark as the sidebar logo, scaled up */}
        <div className="w-20 h-20 rounded-[22px] bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-[0_0_60px_rgba(29,185,84,0.45)]">
          <Music className="w-10 h-10 text-black" strokeWidth={2.5} />
        </div>
        <p className="text-[22px] font-bold tracking-tight">DataFlow</p>
      </div>
    </div>
  );
}
