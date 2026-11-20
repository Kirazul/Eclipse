import { syncLinkedRoles } from "@/lib/linked-roles";

// Called by Vercel's scheduler (vercel.json crons) every day: each connected player's
// looks and upvotes, to Discord, so their Linked Roles follow what they publish.
export async function GET(request: Request) {
  // Vercel sends this header when CRON_SECRET is set. With no secret, nothing passes.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await syncLinkedRoles());
}
