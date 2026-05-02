import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Exclude:
     * - Next.js internals (_next/static, _next/image)
     * - Static assets (svg, png, …)
     * - The OAuth callback route — middleware's getUser() fires an extra
     *   network call to Supabase at exactly the moment GoTrue is processing
     *   the OAuth handshake; excluding it removes that interference and
     *   lets exchangeCodeForSession run with clean, unmodified cookies.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
