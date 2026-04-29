"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserTopArtist } from "@/types/database";

interface TopArtistsChartProps {
  artists: UserTopArtist[];
}

export function TopArtistsChart({ artists }: TopArtistsChartProps) {
  const data = artists.slice(0, 10).map((a) => ({
    name: a.artist_name.length > 15 ? a.artist_name.slice(0, 14) + "..." : a.artist_name,
    fullName: a.artist_name,
    popularity: a.popularity ?? 0,
    genres: a.genres.slice(0, 2).join(", "),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top Artists</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="popularity" radius={[0, 6, 6, 0]} maxBarSize={28}>
              {data.map((_, index) => (
                <Cell
                  key={index}
                  fill={`hsl(var(--chart-${(index % 5) + 1}))`}
                  opacity={1 - index * 0.06}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
