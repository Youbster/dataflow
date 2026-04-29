"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TIME_RANGE_LABELS, type TimeRange } from "@/lib/constants";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as TimeRange)}>
      <TabsList>
        {(Object.entries(TIME_RANGE_LABELS) as [TimeRange, string][]).map(
          ([key, label]) => (
            <TabsTrigger key={key} value={key} className="text-xs">
              {label}
            </TabsTrigger>
          )
        )}
      </TabsList>
    </Tabs>
  );
}
