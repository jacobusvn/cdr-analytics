export async function GET() {
  return new Response(JSON.stringify({ ping: "pong", time: Date.now() }), {
    headers: { "Content-Type": "application/json" },
  });
}
