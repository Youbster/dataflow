"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Search, UserPlus, Link2, Copy, Check, GitCompare } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { UserProfile } from "@/types/database";

interface SocialSearchProfile {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  isFollowing: boolean;
}

export default function SocialPage() {
  const [following, setFollowing] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialSearchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadFollowing();
  }, []);

  async function loadFollowing() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: follows } = await supabase
      .from("user_followers")
      .select("following_id")
      .eq("follower_id", user.id);

    if (follows && follows.length > 0) {
      const ids = follows.map((f) => f.following_id);
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("*")
        .in("id", ids);
      setFollowing(profiles || []);
    }
    setLoading(false);
  }

  async function handleSearch() {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    setSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/social/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setSearchResults(data.users ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleFollow(targetId: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("user_followers")
      .insert({ follower_id: user.id, following_id: targetId });

    if (!error) {
      toast.success("Followed!");
      setSearchResults((results) =>
        results.map((result) =>
          result.id === targetId ? { ...result, isFollowing: true } : result
        )
      );
      await loadFollowing();
    } else {
      toast.error("Failed to follow");
    }
  }

  async function handleShareDashboard() {
    try {
      const res = await fetch("/api/social/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeRange: "medium_term" }),
      });

      if (res.ok) {
        const data = await res.json();
        setShareUrl(data.url);
      }
    } catch {
      toast.error("Failed to create share link");
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied!");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Find People</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Search username or display name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button variant="outline" onClick={handleSearch} disabled={searching || searchQuery.trim().length < 2}>
                <Search className={`w-4 h-4 ${searching ? "animate-pulse" : ""}`} />
              </Button>
            </div>

            {hasSearched && searchResults.length === 0 && !searching && (
              <p className="mt-3 text-xs text-muted-foreground">
                No public profiles found. They may need to enable public profile in Settings.
              </p>
            )}

            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50"
                  >
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={user.avatar_url ?? undefined} />
                      <AvatarFallback>
                        {user.display_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {user.display_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.username ? `@${user.username}` : "No username set"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={user.isFollowing}
                      onClick={() => handleFollow(user.id)}
                    >
                      {user.isFollowing ? (
                        <Check className="w-3.5 h-3.5 mr-1" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5 mr-1" />
                      )}
                      {user.isFollowing ? "Following" : "Follow"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="sm:w-72">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Share Dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Create a snapshot of your dashboard that anyone can view.
            </p>
            <Dialog>
              <DialogTrigger
                className="w-full inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={handleShareDashboard}
              >
                <Link2 className="w-4 h-4 mr-1.5" />
                Create Share Link
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Share Your Dashboard</DialogTitle>
                </DialogHeader>
                {shareUrl ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Input value={shareUrl} readOnly className="flex-1" />
                      <Button variant="outline" onClick={copyShareUrl}>
                        {copied ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Anyone with this link can see a snapshot of your
                      dashboard.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Generating share link...
                  </p>
                )}
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Following</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : following.length === 0 ? (
          <EmptyState
            title="Not following anyone"
            description="Search for friends by username or display name to follow them and compare tastes!"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {following.map((user) => (
              <Card
                key={user.id}
                className="hover:border-primary/30 transition-colors"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={user.avatar_url ?? undefined} />
                      <AvatarFallback>
                        {user.display_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {user.display_name}
                      </p>
                      {user.username && (
                        <p className="text-xs text-muted-foreground">
                          @{user.username}
                        </p>
                      )}
                    </div>
                  </div>
                  <Link href={`/social/compare/${user.id}`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5 text-xs"
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      Compare Taste
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
