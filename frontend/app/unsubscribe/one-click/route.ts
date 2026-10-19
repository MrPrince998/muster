// RFC 8058 one-click unsubscribe: a mail app's own "Unsubscribe" button POSTs
// here (the List-Unsubscribe header), and it acts straight away. The link
// people click opens /unsubscribe instead, which asks first.
const API = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL!;

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  try {
    const res = await fetch(`${API}/public/event-emails/off`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    return new Response(null, { status: res.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
