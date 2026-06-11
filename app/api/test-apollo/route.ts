import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, source: 'root app api test-apollo' });
}
