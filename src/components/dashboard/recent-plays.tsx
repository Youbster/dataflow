"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SpotifyImage } from "@/components/shared/spotify-image";
import type { UserListeningHistory } from "@/types/database";

interface RecentPlaysProps {
  history: UserListeningHistory[];
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecentPlays({ history }: RecentPlaysProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Recent Plays</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="divide-y divide-border">
            {history.map((item) => (
              <a
                key={item.id}
                href={`spotify:track:${item.spotify_track_id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors group"
              >
                <SpotifyImage
                  src={item.album_image_url}
                  alt={item.track_name}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {item.track_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.artist_names.join(", ")}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(item.played_at)}
                </span>
              </a>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
