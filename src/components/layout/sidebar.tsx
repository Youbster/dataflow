"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BarChart3, ListMusic, Activity, Users,
  Settings, Music, Sparkles,
} from "lucide-react";

const mainNav = [
  { href: "/dashboard", label: "Home",       icon: BarChart3 },
  { href: "/discover",  label: "Insights",   icon: Sparkles  },
  { href: "/playlists", label: "Playlists",  icon: ListMusic },
  { href: "/staleness", label: "Ear Health", icon: Activity  },
  { href: "/social",    label: "Social",     icon: Users     },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="glass-sidebar hidden md:flex flex-col w-60 min-h-screen fixed left-0 top-0 z-50">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative w-8 h-8 rounded-[10px] bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-[0_0_18px_rgba(29,185,84,0.4)] group-hover:shadow-[0_0_26px_rgba(29,185,84,0.55)] transition-all duration-300 shrink-0">
            <Music className="w-[15px] h-[15px] text-black" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-[15px] tracking-tight text-foreground">DataFlow</span>
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-4 mb-3 border-t border-white/[0.05]" />

      {/* Main nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {mainNav.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/[0.12] text-primary border border-primary/[0.18] shadow-[0_0_20px_-6px_rgba(29,185,84,0.35)]"
                  : "text-muted-foreground hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
              )}
            >
              <item.icon
                className={cn(
                  "w-[17px] h-[17px] shrink-0 transition-all",
                  isActive ? "text-primary" : "opacity-60"
                )}
                strokeWidth={isActive ? 2 : 1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — settings */}
      <div className="px-3 pb-5 space-y-0.5">
        <div className="mx-1 mb-2 border-t border-white/[0.05]" />
        {[{ href: "/settings", label: "Settings", icon: Settings }].map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/[0.12] text-primary border border-primary/[0.18] shadow-[0_0_20px_-6px_rgba(29,185,84,0.35)]"
                  : "text-muted-foreground hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
              )}
            >
              <item.icon
                className={cn("w-[17px] h-[17px] shrink-0 transition-all", isActive ? "text-primary" : "opacity-60")}
                strokeWidth={isActive ? 2 : 1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
