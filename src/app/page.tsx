import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Music, BarChart3, Sparkles, AlertTriangle, Users } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-14">
          <Link href="/" className="flex items-center gap-2">
            <Music className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">DataFlow</span>
          </Link>
          <Link href="/login">
            <Button size="sm">Get Started</Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-6 py-24 md:py-32 text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl mx-auto leading-tight">
            Your Spotify data,{" "}
            <span className="text-primary">supercharged</span> with AI
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
            Deep listening insights, AI-powered playlist generation, song
            staleness detection, and social features — all from your Spotify
            data.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/login">
              <Button
                size="lg"
                className="h-12 px-8 text-base bg-[#1DB954] hover:bg-[#1ed760] text-white"
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
            </Link>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={BarChart3}
              title="Listening Dashboards"
              description="Visualize your top artists, genres, and listening patterns with beautiful charts."
            />
            <FeatureCard
              icon={Sparkles}
              title="AI Playlists"
              description="Describe a mood or vibe — AI creates a personalized playlist and saves it to Spotify."
            />
            <FeatureCard
              icon={AlertTriangle}
              title="Staleness Detector"
              description="Discover which songs you've been overplaying and get fresh alternatives."
            />
            <FeatureCard
              icon={Users}
              title="Social Features"
              description="Compare tastes with friends and share your dashboards with anyone."
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-sm text-muted-foreground">
          Built with Next.js, Supabase, and Claude AI
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 p-6 space-y-3 hover:border-primary/30 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
