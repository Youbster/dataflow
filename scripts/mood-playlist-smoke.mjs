#!/usr/bin/env node
/**
 * POST /api/ai/mood-playlist against production (or BASE_URL) using a cookie
 * from .env.mood-test — gitignored via .env*
 *
 * File format (single line, no quotes needed unless value has spaces):
 *   MOOD_PLAYLIST_COOKIE=sb-...-auth-token=...; other-cookies=...
 *
 * Usage: node scripts/mood-playlist-smoke.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.mood-test");

const BASE = process.env.BASE_URL ?? "https://dataflow-weld.vercel.app";

function loadCookie() {
  if (process.env.MOOD_PLAYLIST_COOKIE?.trim()) {
    return process.env.MOOD_PLAYLIST_COOKIE.trim();
  }
  if (!fs.existsSync(envPath)) {
    console.error(
      "Missing .env.mood-test (or MOOD_PLAYLIST_COOKIE env).\n" +
        "Create " +
        envPath +
        " with one line:\n  MOOD_PLAYLIST_COOKIE=<browser Cookie header for " +
        BASE +
        ">",
    );
    process.exit(2);
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^MOOD_PLAYLIST_COOKIE=(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  console.error(".env.mood-test must contain MOOD_PLAYLIST_COOKIE=...");
  process.exit(3);
}

const body = {
  goal: "build_vibe",
  prompt: "Chill — relaxed, laid-back, easy",
  sessionMinutes: 60,
  familiarity: "mixed",
  intensity: "low",
  vocals: "any",
  language: "any",
  genreLock: null,
  artistLock: null,
};

const cookie = loadCookie();
const url = `${BASE.replace(/\/$/, "")}/api/ai/mood-playlist`;

const t0 = performance.now();
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
  },
  body: JSON.stringify(body),
});
const ms = Math.round(performance.now() - t0);
const text = await res.text();
let preview = text.slice(0, 220).replace(/\s+/g, " ");
if (preview.length >= 220) preview += "…";

console.log(JSON.stringify({ url, status: res.status, ms, bodyPreview: preview }, null, 2));
