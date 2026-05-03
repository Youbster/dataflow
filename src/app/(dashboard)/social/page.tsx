"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Compass, GitCompare, Search, Sparkles, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface SocialSearchProfile {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  isFollowing: boolean;
}

interface SocialFriend {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  topGenres: string[];
  compatibilityScore: number;
  uniqueArtists: string[];
  uniqueGenres: string[];
}

function GenreChips({ genres }: { genres: string[] }) {
  if (genres.length === 0) {
    return <p className="text-xs text-muted-foreground">Taste data syncing</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {genres.slice(0, 3).map((genre) => (
        <span key={genre} className="text-[10px] px-2 py-0.5 rounded-full border border-primary/20 bg-primary/10 text-primary capitalize">
          {genre}
        </span>
      ))}
    </div>
  );
}

function FriendMiniCard({
  friend,
  icon,
  title,
  description,
}: {
  friend: SocialFriend | null;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-border/80">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <p className="text-[10px] font-bold uppercase tracking-widest">{title}</p>
        </div>
        {friend ? (
          <>
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={friend.avatarUrl ?? undefined} />
                <AvatarFallback>{friend.displayName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{friend.displayName}</p>
                <p className="text-xs text-muted-foreground">{friend.compatibilityScore}% match</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            <Link href={`/social/compare/${friend.id}`}>
              <Button size="sm" variant="outline" className="w-full text-xs">
                <GitCompare className="w-3.5 h-3.5 mr-1.5" />
                Open taste match
              </Button>
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Follow people to unlock this.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SocialPage() {
  const [following, setFollowing] = useState<SocialFriend[]>([]);
  const [closest, setClosest] = useState<SocialFriend | null>(null);
  const [mostDifferent, setMostDifferent] = useState<SocialFriend | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialSearchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    loadSocial();
  }, []);

  async function loadSocial() {
    setLoading(true);
    try {
      const res = await fetch("/api/social/summary");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load social");
      setFollowing(data.following ?? []);
      setClosest(data.closest ?? null);
      setMostDifferent(data.mostDifferent ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load social");
    } finally {
      setLoading(false);
    }
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
      toast.success("Followed");
      setSearchResults((results) =>
        results.map((result) =>
          result.id === targetId ? { ...result, isFollowing: true } : result
        )
      );
      await loadSocial();
    } else {
      toast.error("Failed to follow");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
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
                    <AvatarFallback>{user.display_name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.username ? `@${user.username}` : "No username set"}
                    </p>
                  </div>
                  {user.isFollowing ? (
                    <Link href={`/social/compare/${user.id}`}>
                      <Button size="sm" variant="outline">
                        <GitCompare className="w-3.5 h-3.5 mr-1" />
                        Compare
                      </Button>
                    </Link>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleFollow(user.id)}>
                      <UserPlus className="w-3.5 h-3.5 mr-1" />
                      Follow
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Taste Circle</h2>
          <p className="text-xs text-muted-foreground">{following.length} following</p>
        </div>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FriendMiniCard
              friend={closest}
              icon={<Users className="w-3.5 h-3.5" />}
              title="Closest match"
              description="Best starting point for a playlist swap or shared taste check."
            />
            <FriendMiniCard
              friend={mostDifferent}
              icon={<Compass className="w-3.5 h-3.5" />}
              title="Most different"
              description="Best person to use when you want to escape your algorithm."
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Following</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : following.length === 0 ? (
          <EmptyState
            title="No taste circle yet"
            description="Find friends by username or display name to compare taste and use their music to break your loop."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {following.map((friend) => (
              <Card key={friend.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={friend.avatarUrl ?? undefined} />
                      <AvatarFallback>{friend.displayName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{friend.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {friend.username ? `@${friend.username}` : `${friend.compatibilityScore}% match`}
                      </p>
                    </div>
                  </div>

                  <GenreChips genres={friend.topGenres} />

                  <div className="grid grid-cols-2 gap-2">
                    <Link href={`/social/compare/${friend.id}`}>
                      <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs">
                        <GitCompare className="w-3.5 h-3.5" />
                        Compare
                      </Button>
                    </Link>
                    <Link href={`/social/compare/${friend.id}`}>
                      <Button size="sm" className="w-full gap-1.5 text-xs">
                        <Sparkles className="w-3.5 h-3.5" />
                        Use Taste
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
