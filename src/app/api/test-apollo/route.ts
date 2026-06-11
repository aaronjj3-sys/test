import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing APOLLO_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      accept: "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      person_titles: ["founder", "co-founder"],
      person_seniorities: ["founder", "c_suite"],
      q_organization_domains_list: ["ycombinator.com"],
      page: 1,
      per_page: 5,
    }),
  });

  const data = await response.json();

  return NextResponse.json({
    ok: response.ok,
    status: response.status,
    peopleCount: data.people?.length ?? 0,
    sample: data.people?.slice(0, 2) ?? [],
    error: response.ok ? null : data,
  });
}