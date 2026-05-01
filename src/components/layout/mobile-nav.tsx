"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Menu, BarChart3, ListMusic, AlertTriangle, Users,
  Settings, Music, Sparkles, Gift, Package,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard",   icon: BarChart3     },
  { href: "/discover",  label: "Discover",     icon: Sparkles      },
  { href: "/wrapped",   label: "Wrapped",      icon: Gift          },
  { href: "/mystery",   label: "Mystery Box",  icon: Package       },
  { href: "/playlists", label: "Playlists",    icon: ListMusic     },
  { href: "/staleness", label: "Staleness",    icon: AlertTriangle },
  { href: "/social",    label: "Social",       icon: Users         },
  { href: "/settings",  label: "Settings",     icon: Settings      },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="md:hidden inline-flex items-center justify-center rounded-xl w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">
        <Menu className="w-5 h-5" />
      </SheetTrigger>

      <SheetContent side="left" className="w-60 p-0 border-r border-white/[0.06] bg-[rgba(9,10,20,0.95)] backdrop-blur-2xl">
        {/* Logo */}
        <div className="px-5 pt-6 pb-5">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-[0_0_18px_rgba(29,185,84,0.4)] shrink-0">
              <Music className="w-[15px] h-[15px] text-black" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-[15px] tracking-tight">DataFlow</span>
          </Link>
        </div>

        <div className="mx-4 mb-3 border-t border-white/[0.05]" />

        <nav className="px-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150",
                  isActive
                    ? "bg-primary/[0.12] text-primary border border-primary/[0.18] shadow-[0_0_20px_-6px_rgba(29,185,84,0.35)]"
                    : "text-muted-foreground hover:text-foreground/90 hover:bg-white/[0.05] border border-transparent"
                )}
              >
                <item.icon
                  className={cn("w-[17px] h-[17px] shrink-0", isActive ? "text-primary" : "opacity-60")}
                  strokeWidth={isActive ? 2 : 1.75}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
