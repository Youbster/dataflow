"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserListeningHistory } from "@/types/database";

interface ListeningTimelineProps {
  history: UserListeningHistory[];
}

export function ListeningTimeline({ history }: ListeningTimelineProps) {
  const dayMap = new Map<string, number>();

  for (const item of history) {
    const day = new Date(item.played_at).toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }

  const allDays = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, plays: count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Listening Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {allDays.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={allDays}>
              <defs>
                <linearGradient id="playGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5)}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="plays"
                stroke="hsl(var(--primary))"
                fill="url(#playGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Keep listening to build your activity timeline!
          </p>
        )}
      </CardContent>
    </Card>
  );
}
