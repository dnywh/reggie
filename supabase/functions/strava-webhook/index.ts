import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET");
const STRAVA_WEBHOOK_VERIFY_TOKEN = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN");

console.info("🪝 Strava webhook handler starting...");

// Reuse token refresh logic from strava-sync
interface User {
    id: string;
    email: string;
    strava_access_token?: string;
    strava_refresh_token?: string;
    strava_token_expires_at?: string;
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
            strava_token_expires_at: new Date(data.expires_at * 1000)
                .toISOString(),
        }).eq("id", user.id);
        if (error) throw error;
        return data.access_token;
    }
    return user.strava_access_token;
}

// Reuse activity formatting logic from strava-sync
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

function formatActivity(activity: StravaActivity, userId: string) {
    const distance_km = activity.distance / 1000;
    const duration_min = activity.moving_time / 60;
    const avg_pace_min_km = distance_km > 0 ? duration_min / distance_km : null;

    // Extract timezone from Strava's timezone field (e.g., "(GMT-08:00) America/Los_Angeles")
    const timezoneMatch = activity.timezone?.match(/\([^)]+\)\s*(.+)/);
    const timezone = timezoneMatch ? timezoneMatch[1] : null;

    // Store Strava's local time directly (timestamp column, no timezone conversion)
    let start_date_local = activity.start_date_local;
    if (activity.start_date_local && activity.start_date_local.endsWith("Z")) {
        start_date_local = activity.start_date_local.slice(0, -1); // Remove the Z
        console.log(`🏃 Run ${activity.id}: Storing local time directly`);
        console.log(`  Strava local: ${activity.start_date_local}`);
        console.log(`  Stored as: ${start_date_local}`);
        console.log(`  Timezone: ${timezone}`);
    }

    return {
        user_id: userId,
        strava_id: activity.id,
        start_date_local: start_date_local, // Local time stored directly (timestamp column)
        timezone: timezone, // Run-specific timezone
        distance_km,
        duration_min,
        avg_pace_min_km,
        notes: activity.name ?? null,
        total_elevation_gain: activity.total_elevation_gain ?? null,
        average_heartrate: activity.average_heartrate ?? null,
        max_heartrate: activity.max_heartrate ?? null,
        suffer_score: activity.suffer_score ?? null,
    };
}

interface WebhookEvent {
    object_type: "activity" | "athlete";
    object_id: number;
    aspect_type: "create" | "update" | "delete";
    updates?: Record<string, unknown>;
    owner_id: string;
    subscription_id: number;
    event_time: number;
}

async function handleActivityEvent(event: WebhookEvent) {
    try {
        console.log(
            `📊 Processing activity event: ${event.aspect_type} for activity ${event.object_id}`,
        );

        // Get the user who owns this activity
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("*")
            .eq("id", event.owner_id)
            .single();

        if (userError || !user) {
            console.error(
                `❌ User not found for owner_id ${event.owner_id}:`,
                userError,
            );
            return;
        }

        if (event.aspect_type === "delete") {
            // Remove the run from database
            const { error } = await supabase
                .from("runs")
                .delete()
                .eq("strava_id", event.object_id);

            if (error) {
                console.error(
                    `❌ Failed to delete run ${event.object_id}:`,
                    error,
                );
            } else {
                console.log(`✅ Deleted run ${event.object_id}`);
            }
            return;
        }

        // For create/update, fetch the full activity details
        const accessToken = await refreshTokenIfNeeded(user);
        const res = await fetch(
            `https://www.strava.com/api/v3/activities/${event.object_id}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            },
        );

        if (!res.ok) {
            console.error(
                `❌ Failed to fetch activity ${event.object_id}: ${res.status}`,
            );
            return;
        }

        const activity = await res.json() as StravaActivity;

        // Only process Run activities
        if (activity.type !== "Run") {
            console.log(`⏭️ Skipping non-run activity: ${activity.type}`);
            return;
        }

        const formatted = formatActivity(activity, user.id);

        // Upsert the run
        const { error } = await supabase.from("runs").upsert(formatted, {
            onConflict: "strava_id",
        });

        if (error) {
            console.error(`❌ Failed to upsert run ${event.object_id}:`, error);
        } else {
            console.log(
                `✅ Processed ${event.aspect_type} for run ${event.object_id}`,
            );
        }
    } catch (err) {
        console.error(`❌ Error processing activity event:`, err);
    }
}

async function handleAthleteEvent(event: WebhookEvent) {
    try {
        console.log(
            `👤 Processing athlete event: ${event.aspect_type} for athlete ${event.object_id}`,
        );

        if (
            event.aspect_type === "update" &&
            event.updates?.authorized === false
        ) {
            // Athlete deauthorized the app - delete their data
            const { error } = await supabase
                .from("users")
                .delete()
                .eq("id", event.object_id);

            if (error) {
                console.error(
                    `❌ Failed to delete user ${event.object_id}:`,
                    error,
                );
            } else {
                console.log(
                    `✅ Deleted user ${event.object_id} and all associated runs (cascade)`,
                );
            }
        }
    } catch (err) {
        console.error(`❌ Error processing athlete event:`, err);
    }
}

Deno.serve(async (req: Request) => {
    try {
        const method = req.method;
        const url = new URL(req.url);

        // Handle GET requests (webhook subscription validation)
        if (method === "GET") {
            const hubMode = url.searchParams.get("hub.mode");
            const hubChallenge = url.searchParams.get("hub.challenge");
            const hubVerifyToken = url.searchParams.get("hub.verify_token");

            console.log(
                `🔍 Validation request: mode=${hubMode}, token=${hubVerifyToken}`,
            );

            if (
                hubMode === "subscribe" &&
                hubVerifyToken === STRAVA_WEBHOOK_VERIFY_TOKEN
            ) {
                console.log(
                    `✅ Webhook validation successful, echoing challenge: ${hubChallenge}`,
                );
                return new Response(
                    JSON.stringify({ "hub.challenge": hubChallenge }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            } else {
                console.log(`❌ Webhook validation failed`);
                return new Response("Forbidden", { status: 403 });
            }
        }

        // Handle POST requests (webhook events)
        if (method === "POST") {
            const event = await req.json() as WebhookEvent;
            console.log(`📨 Received webhook event:`, event);

            // Always acknowledge receipt first (within 2 seconds)
            const response = new Response("OK", { status: 200 });

            // Process event asynchronously
            if (event.object_type === "activity") {
                await handleActivityEvent(event);
            } else if (event.object_type === "athlete") {
                await handleAthleteEvent(event);
            } else {
                console.log(`⚠️ Unknown object_type: ${event.object_type}`);
            }

            return response;
        }

        return new Response("Method not allowed", { status: 405 });
    } catch (err) {
        console.error("❌ Webhook handler error:", err);
        // Always return 200 to avoid retries
        return new Response("OK", { status: 200 });
    }
});
