import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET");
console.info("🦘 Reggie's Strava sync booting up...");
console.info(
  "📝 Note: This function serves as a backup to webhook events and handles initial syncs",
);
interface User {
  id: string;
  email: string;
  strava_access_token?: string;
  strava_refresh_token?: string;
  strava_token_expires_at?: string;
}

interface StravaActivity {
  id: number;
  type: string;
  distance: number;
  moving_time: number;
  timezone?: string;
  start_date_local: string;
  name?: string;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
}

async function refreshTokenIfNeeded(user: User) {
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
    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };
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
async function fetchAndStoreRuns(userId: string, accessToken: string) {
  const res = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?per_page=30",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!res.ok) throw new Error(`Strava API error ${res.status}`);
  const activities = await res.json() as StravaActivity[];
  // Filter to runs only
  const runs = activities.filter((a: StravaActivity) => a.type === "Run");
  const formatted = runs.map((a: StravaActivity) => {
    const distance_km = a.distance / 1000;
    const duration_min = a.moving_time / 60;
    const avg_pace_min_km = distance_km > 0 ? duration_min / distance_km : null;

    // Extract timezone from Strava's timezone field (e.g., "(GMT-08:00) America/Los_Angeles")
    const timezoneMatch = a.timezone?.match(/\([^)]+\)\s*(.+)/);
    const timezone = timezoneMatch ? timezoneMatch[1] : null;

    // Store Strava's local time directly (timestamp column, no timezone conversion)
    let start_date_local = a.start_date_local;
    if (a.start_date_local && a.start_date_local.endsWith("Z")) {
      start_date_local = a.start_date_local.slice(0, -1); // Remove the Z
      console.log(`🏃 Run ${a.id}: Storing local time directly`);
      console.log(`  Strava local: ${a.start_date_local}`);
      console.log(`  Stored as: ${start_date_local}`);
      console.log(`  Timezone: ${timezone}`);
    }

    return {
      user_id: userId,
      strava_id: a.id, // The run's unique identifier in Strava
      start_date_local: start_date_local, // Local time stored directly (timestamp column)
      timezone: timezone, // Run-specific timezone
      distance_km,
      duration_min,
      avg_pace_min_km,
      notes: a.name ?? null,
      total_elevation_gain: a.total_elevation_gain ?? null,
      average_heartrate: a.average_heartrate ?? null,
      max_heartrate: a.max_heartrate ?? null,
      suffer_score: a.suffer_score ?? null,
    };
  });
  const { error } = await supabase.from("runs").upsert(formatted, {
    onConflict: "strava_id",
  });
  if (error) throw error;
  console.log(`✅ Synced ${formatted.length} runs for user ${userId}`);

  // Let's check what actually got stored in the database
  const { data: storedRuns } = await supabase.from("runs")
    .select("strava_id, start_date_local, timezone")
    .eq("user_id", userId)
    .in("strava_id", formatted.map((f) => f.strava_id))
    .order("start_date_local", { ascending: false });

  console.log(`📊 What's actually stored in DB:`);
  storedRuns?.forEach((run) => {
    console.log(
      `  Run ${run.strava_id}: ${run.start_date_local} (${run.timezone})`,
    );
  });
}
Deno.serve(async () => {
  try {
    // 1️⃣ Get all users who have Strava linked
    // This function serves as a backup to webhook events and handles initial syncs
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
        if (accessToken) {
          await fetchAndStoreRuns(user.id, accessToken);
        }
      } catch (err: unknown) {
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
  } catch (err: unknown) {
    console.error("❌ Sync failed:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
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
