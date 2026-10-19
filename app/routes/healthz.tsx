// Container health check (Lightsail pings this). Deliberately no DB query:
// a Neon blip shouldn't make Lightsail recycle healthy containers.
export const loader = () => new Response("ok", { headers: { "Cache-Control": "no-store" } });
