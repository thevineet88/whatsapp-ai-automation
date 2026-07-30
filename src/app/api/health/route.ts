// Render uses this to decide whether the web service is alive. Returns 200
// without touching the database or any external service so a cold start
// can pass the health check before the app finishes initialising.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true });
}
