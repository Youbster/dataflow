"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BarChart3, Sparkles, Activity, ListMusic, Users } from "lucide-react";

const tabs = [
  { href: "/dashboard",  label: "Home",       icon: BarChart3 },
  { href: "/discover",   label: "Insights",   icon: Sparkles  },
  { href: "/staleness",  label: "Ear Health", icon: Activity  },
  { href: "/playlists",  label: "Playlists",  icon: ListMusic },
  { href: "/social",     label: "Social",     icon: Users     },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.06] bg-[rgba(9,10,20,0.97)] backdrop-blur-2xl safe-area-inset-bottom">
      <div className="flex items-center justify-around h-14 px-1">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <tab.icon
                className={cn("w-5 h-5 shrink-0 transition-all", isActive ? "text-primary" : "opacity-50")}
                strokeWidth={isActive ? 2.2 : 1.75}
              />
              <span className={cn(
                "text-[10px] font-medium leading-none",
                isActive ? "text-primary" : "text-muted-foreground/60"
              )}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
