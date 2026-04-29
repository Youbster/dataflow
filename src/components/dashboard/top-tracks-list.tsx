"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpotifyImage } from "@/components/shared/spotify-image";
import type { UserTopTrack } from "@/types/database";

interface TopTracksListProps {
  tracks: UserTopTrack[];
}

export function TopTracksList({ tracks }: TopTracksListProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top Tracks</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {tracks.slice(0, 20).map((track) => (
            <div
              key={track.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors"
            >
              <span className="w-5 text-xs text-muted-foreground text-right tabular-nums">
                {track.rank}
              </span>
              <SpotifyImage
                src={track.album_image_url}
                alt={track.track_name}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {track.track_name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {track.artist_names.join(", ")}
                </p>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {track.duration_ms
                  ? `${Math.floor(track.duration_ms / 60000)}:${String(
                      Math.floor((track.duration_ms % 60000) / 1000)
                    ).padStart(2, "0")}`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
