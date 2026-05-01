import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ToasterProvider } from "@/components/providers/toaster-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const fontSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DataFlow — Spotify Insights & AI Music Discovery",
  description:
    "Connect your Spotify account to get deep listening insights, AI-powered playlist recommendations, and discover new music you'll love.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <ToasterProvider />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
