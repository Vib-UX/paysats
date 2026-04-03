import { NextResponse } from "next/server";
import { fetchIdrxPoolDashboard } from "@/lib/idrx-pools-dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchIdrxPoolDashboard();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "IDRX pools unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
