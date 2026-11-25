import { adminConfigured, sweepGamePictures } from "@/lib/data/admin";

// Called by Vercel's scheduler (vercel.json crons) every day. A game sends a new picture
// when a set's look changes, and this removes the files of the ones it replaced.
export async function GET(request: Request) {
  // Vercel sends this header when CRON_SECRET is set. With no secret, nothing passes.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  if (!adminConfigured()) return Response.json({ removed: 0 });
  try {
    return Response.json({ removed: await sweepGamePictures() });
  } catch (error) {
    console.error("The picture sweep failed:", error);
    return Response.json({ removed: 0 }, { status: 500 });
  }
}
