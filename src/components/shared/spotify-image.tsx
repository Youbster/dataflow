"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { Music } from "lucide-react";

interface SpotifyImageProps {
  src: string | null | undefined;
  alt: string;
  size?: "sm" | "md" | "lg";
  rounded?: boolean;
  className?: string;
}

const sizes = { sm: 40, md: 56, lg: 80 };

export function SpotifyImage({
  src,
  alt,
  size = "md",
  rounded = false,
  className,
}: SpotifyImageProps) {
  const px = sizes[size];

  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted",
          rounded ? "rounded-full" : "rounded-md",
          className
        )}
        style={{ width: px, height: px }}
      >
        <Music className="w-1/2 h-1/2 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={px}
      height={px}
      className={cn(
        "object-cover",
        rounded ? "rounded-full" : "rounded-md",
        className
      )}
    />
  );
}
