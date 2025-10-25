import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET");
const STRAVA_WEBHOOK_VERIFY_TOKEN = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN");

console.info("🔧 Strava webhook setup handler starting...");

async function createWebhookSubscription() {
    const callbackUrl = `${
        Deno.env.get("SUPABASE_URL")
    }/functions/v1/strava-webhook`;

    console.log(
        `📡 Creating webhook subscription with callback: ${callbackUrl}`,
    );

    const formData = new FormData();
    formData.append("client_id", STRAVA_CLIENT_ID!);
    formData.append("client_secret", STRAVA_CLIENT_SECRET!);
    formData.append("callback_url", callbackUrl);
    formData.append("verify_token", STRAVA_WEBHOOK_VERIFY_TOKEN!);

    const response = await fetch(
        "https://www.strava.com/api/v3/push_subscriptions",
        {
            method: "POST",
            body: formData,
        },
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Failed to create subscription: ${response.status} - ${errorText}`,
        );
    }

    const data = await response.json() as { id: number };
    console.log(`✅ Created webhook subscription with ID: ${data.id}`);

    return data.id;
}

async function viewWebhookSubscription() {
    const params = new URLSearchParams({
        client_id: STRAVA_CLIENT_ID!,
        client_secret: STRAVA_CLIENT_SECRET!,
    });

    const response = await fetch(
        `https://www.strava.com/api/v3/push_subscriptions?${params}`,
        {
            method: "GET",
        },
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Failed to view subscriptions: ${response.status} - ${errorText}`,
        );
    }

    const data = await response.json();
    console.log(`📋 Current subscriptions:`, data);

    return data;
}

async function deleteWebhookSubscription(subscriptionId: number) {
    const params = new URLSearchParams({
        client_id: STRAVA_CLIENT_ID!,
        client_secret: STRAVA_CLIENT_SECRET!,
    });

    const response = await fetch(
        `https://www.strava.com/api/v3/push_subscriptions/${subscriptionId}?${params}`,
        {
            method: "DELETE",
        },
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Failed to delete subscription: ${response.status} - ${errorText}`,
        );
    }

    console.log(`🗑️ Deleted webhook subscription ${subscriptionId}`);
    return true;
}

async function storeSubscriptionId(subscriptionId: number) {
    const { error } = await supabase
        .from("strava_webhook_subscription")
        .upsert({ id: 1, subscription_id: subscriptionId }, {
            onConflict: "id",
        });

    if (error) {
        throw new Error(`Failed to store subscription ID: ${error.message}`);
    }

    console.log(`💾 Stored subscription ID ${subscriptionId} in database`);
}

async function getStoredSubscriptionId() {
    const { data, error } = await supabase
        .from("strava_webhook_subscription")
        .select("subscription_id")
        .eq("id", 1)
        .single();

    if (error && error.code !== "PGRST116") { // PGRST116 = no rows found
        throw new Error(`Failed to get subscription ID: ${error.message}`);
    }

    return data?.subscription_id;
}

Deno.serve(async (req: Request) => {
    try {
        const url = new URL(req.url);
        const action = url.searchParams.get("action");
        const method = req.method;

        console.log(`🔧 Webhook setup request: ${method} ${action}`);

        switch (action) {
            case "create": {
                if (method !== "POST") {
                    return new Response("Method not allowed", { status: 405 });
                }

                // Check if subscription already exists
                const existingId = await getStoredSubscriptionId();
                if (existingId) {
                    console.log(
                        `⚠️ Subscription already exists with ID: ${existingId}`,
                    );
                    return new Response(
                        JSON.stringify({
                            message: "Subscription already exists",
                            subscription_id: existingId,
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        },
                    );
                }

                const subscriptionId = await createWebhookSubscription();
                await storeSubscriptionId(subscriptionId);

                return new Response(
                    JSON.stringify({
                        message: "Webhook subscription created successfully",
                        subscription_id: subscriptionId,
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }

            case "view": {
                if (method !== "GET") {
                    return new Response("Method not allowed", { status: 405 });
                }

                const subscriptions = await viewWebhookSubscription();
                const storedId = await getStoredSubscriptionId();

                return new Response(
                    JSON.stringify({
                        subscriptions,
                        stored_subscription_id: storedId,
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }

            case "delete": {
                if (method !== "DELETE") {
                    return new Response("Method not allowed", { status: 405 });
                }

                const storedId = await getStoredSubscriptionId();
                if (!storedId) {
                    return new Response(
                        JSON.stringify({
                            message: "No subscription to delete",
                        }),
                        {
                            status: 404,
                            headers: { "Content-Type": "application/json" },
                        },
                    );
                }

                await deleteWebhookSubscription(storedId);

                // Remove from database
                const { error } = await supabase
                    .from("strava_webhook_subscription")
                    .delete()
                    .eq("id", 1);

                if (error) {
                    console.error(
                        `❌ Failed to remove subscription from database:`,
                        error,
                    );
                }

                return new Response(
                    JSON.stringify({
                        message: "Webhook subscription deleted successfully",
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }

            default:
                return new Response(
                    JSON.stringify({
                        error: "Invalid action. Use: create, view, or delete",
                    }),
                    {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    },
                );
        }
    } catch (err: unknown) {
        console.error("❌ Webhook setup error:", err);
        return new Response(
            JSON.stringify({
                error: err instanceof Error ? err.message : "Unknown error",
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            },
        );
    }
});
