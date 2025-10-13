import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET");
console.info("🦘 Reggie’s Strava sync booting up...");
async function refreshTokenIfNeeded(user) {
  const now = Date.now();
  const expiresAt = new Date(user.strava_token_expires_at ?? 0).getTime();
  // Refresh if missing or expired (allow 1-min buffer)
  if (!expiresAt || expiresAt - now < 60_000) {
    console.log(`🔄 Refreshing token for ${user.email}`);
    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: user.strava_refresh_token,
      }),
    });
    if (!res.ok) throw new Error(`Failed to refresh: ${res.status}`);
    const data = await res.json();
    // Persist the new tokens in the DB
    const { error } = await supabase.from("users").update({
      strava_access_token: data.access_token,
      strava_refresh_token: data.refresh_token,
      strava_token_expires_at: new Date(data.expires_at * 1000).toISOString(),
    }).eq("id", user.id);
    if (error) throw error;
    return data.access_token;
  }
  return user.strava_access_token;
}
async function fetchAndStoreRuns(userId, accessToken) {
  const res = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?per_page=30",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!res.ok) throw new Error(`Strava API error ${res.status}`);
  const activities = await res.json();
  // Filter to runs only
  const runs = activities.filter((a) => a.type === "Run");
  const formatted = runs.map((a) => {
    const distance_km = a.distance / 1000;
    const duration_min = a.moving_time / 60;
    const avg_pace_min_km = distance_km > 0 ? duration_min / distance_km : null;

    // Extract timezone from Strava's timezone field (e.g., "(GMT-08:00) America/Los_Angeles")
    const timezoneMatch = a.timezone?.match(/\([^)]+\)\s*(.+)/);
    const timezone = timezoneMatch ? timezoneMatch[1] : null;

    return {
      user_id: userId,
      strava_id: a.id,
      start_date_local: a.start_date_local, // Full local timestamp
      timezone: timezone, // Run-specific timezone
      distance_km,
      duration_min,
      avg_pace_min_km,
      notes: a.name ?? null,
    };
  });
  const { error } = await supabase.from("runs").upsert(formatted, {
    onConflict: "strava_id",
  });
  if (error) throw error;
  console.log(`✅ Synced ${formatted.length} runs for user ${userId}`);
}
Deno.serve(async () => {
  try {
    // 1️⃣ Get all users who have Strava linked
    const { data: users, error } = await supabase.from("users").select("*").not(
      "strava_refresh_token",
      "is",
      null,
    );
    if (error) throw error;
    if (!users?.length) throw new Error("No users with Strava connected");
    // 2️⃣ Loop through each user
    for (const user of users) {
      try {
        const accessToken = await refreshTokenIfNeeded(user);
        await fetchAndStoreRuns(user.id, accessToken);
      } catch (err) {
        console.error(`❌ Failed for ${user.email}:`, err);
      }
    }
    return new Response(
      JSON.stringify({
        success: true,
        users: users.length,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("❌ Sync failed:", err);
    return new Response(
      JSON.stringify({
        error: err.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
});
