"use client";

import { createClient } from "@/lib/supabase/client";
import { SPOTIFY_SCOPES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Music, BarChart3, Sparkles, Users, AlertCircle } from "lucide-react";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// useSearchParams() requires a Suspense boundary in Next.js — extract it
// into a child component so the build doesn't fail during prerendering.
function LoginContent() {
  const searchParams = useSearchParams();
  const [authError, setAuthError] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.slice(1));
        const desc = params.get("error_description");
        if (desc) return decodeURIComponent(desc.replace(/\+/g, " "));
      }
    }

    const qErr = searchParams.get("error");
    if (!qErr) return null;
    return qErr === "no_code"
      ? "Login was cancelled or failed. Please try again."
      : `Login error: ${qErr}`;
  });

  useEffect(() => {
    // Supabase sends OAuth errors in the URL hash (e.g. #error_description=…).
    // The server never sees hash params, so we read them client-side.
    const hash = window.location.hash;
    if (hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  async function handleSpotifyLogin() {
    setAuthError(null);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "spotify",
      options: {
        scopes: SPOTIFY_SCOPES,
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  }

  return (
    <div className="w-full max-w-md px-4">
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Music className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Escapify</h1>
            <p className="text-muted-foreground mt-2">
              AI-powered music insights from your Spotify data
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-4">
          <div className="space-y-3">
            <Feature icon={BarChart3} text="Deep listening dashboards & trends" />
            <Feature icon={Sparkles} text="AI playlists tailored to your taste" />
            <Feature icon={Music} text="Detect overplayed songs & find fresh music" />
            <Feature icon={Users} text="Compare tastes & share with friends" />
          </div>

          {authError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <Button
            onClick={handleSpotifyLogin}
            className="w-full h-12 text-base font-semibold bg-[#1DB954] hover:bg-[#1ed760] text-white"
            size="lg"
          >
            <svg
              className="w-5 h-5 mr-2"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            Connect with Spotify
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            We only read your listening data. You can disconnect anytime.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Feature({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Icon className="w-4 h-4 text-primary shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
