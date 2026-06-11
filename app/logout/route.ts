import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  return NextResponse.redirect(new URL("/login", appUrl));
}
