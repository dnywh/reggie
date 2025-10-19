import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req: Request) => {
    try {
        if (req.method !== "GET") {
            return new Response("Method not allowed", { status: 405 });
        }

        const url = new URL(req.url);
        const token = url.searchParams.get("token");

        if (!token) {
            console.error("Missing token parameter");
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":
                        "https://www.reggie.run/preferences/error?error=" +
                        encodeURIComponent("Missing confirmation token"),
                },
            });
        }

        const supabase = createClient(
            SUPABASE_URL!,
            SUPABASE_SERVICE_ROLE_KEY!,
        );

        // Validate token and get user info
        const { data: tokenData, error: tokenError } = await supabase
            .from("preference_tokens")
            .select(`
        id,
        user_id,
        action,
        expires_at,
        used,
        users!inner(id, name, email)
      `)
            .eq("token", token)
            .eq("action", "pause")
            .eq("used", false)
            .single();

        if (tokenError || !tokenData) {
            console.error("Token validation failed:", tokenError);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":
                        "https://www.reggie.run/preferences/error?error=" +
                        encodeURIComponent(
                            "Invalid or expired confirmation token",
                        ),
                },
            });
        }

        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(tokenData.expires_at);
        if (now > expiresAt) {
            console.error("Token expired");
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":
                        "https://www.reggie.run/preferences/error?error=" +
                        encodeURIComponent("Confirmation token has expired"),
                },
            });
        }

        // Mark token as used
        const { error: markUsedError } = await supabase
            .from("preference_tokens")
            .update({
                used: true,
                used_at: new Date().toISOString(),
            })
            .eq("id", tokenData.id);

        if (markUsedError) {
            console.error("Failed to mark token as used:", markUsedError);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":
                        "https://www.reggie.run/preferences/error?error=" +
                        encodeURIComponent("Failed to process confirmation"),
                },
            });
        }

        // Update user's is_active status
        const { error: updateError } = await supabase
            .from("users")
            .update({
                is_active: false,
            })
            .eq("id", tokenData.user_id);

        if (updateError) {
            console.error("Failed to update user status:", updateError);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":
                        "https://www.reggie.run/preferences/error?error=" +
                        encodeURIComponent("Failed to update preferences"),
                },
            });
        }

        console.log(
            `✅ Successfully paused emails for user: ${tokenData.users.email}`,
        );

        // Redirect to success page
        return new Response(null, {
            status: 302,
            headers: {
                "Location": "https://www.reggie.run/preferences/paused",
            },
        });
    } catch (error) {
        console.error("❌ Confirm pause error:", error);
        return new Response(null, {
            status: 302,
            headers: {
                "Location": "https://www.reggie.run/preferences/error?error=" +
                    encodeURIComponent("An unexpected error occurred"),
            },
        });
    }
});
