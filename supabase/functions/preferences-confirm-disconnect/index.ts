import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET");

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
        users!inner(id, name, email, strava_access_token, strava_refresh_token)
      `)
            .eq("token", token)
            .eq("action", "disconnect")
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

        // Deauthorize from Strava (attempt token refresh if needed)
        const joinedUser = Array.isArray(tokenData.users)
            ? tokenData.users[0]
            : tokenData.users;
        if (
            joinedUser?.strava_access_token || joinedUser?.strava_refresh_token
        ) {
            try {
                // Try deauthorize with existing access token first
                let accessToken = joinedUser.strava_access_token as
                    | string
                    | null;
                let deauthRes: Response | null = null;

                if (accessToken) {
                    deauthRes = await fetch(
                        "https://www.strava.com/oauth/deauthorize",
                        {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${accessToken}`,
                            },
                        },
                    );
                }

                // If we didn't have an access token, or it failed (e.g., expired), try refreshing
                if (!deauthRes || !deauthRes.ok) {
                    if (
                        joinedUser.strava_refresh_token && STRAVA_CLIENT_ID &&
                        STRAVA_CLIENT_SECRET
                    ) {
                        try {
                            const refreshRes = await fetch(
                                "https://www.strava.com/oauth/token",
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        client_id: STRAVA_CLIENT_ID,
                                        client_secret: STRAVA_CLIENT_SECRET,
                                        grant_type: "refresh_token",
                                        refresh_token:
                                            joinedUser.strava_refresh_token,
                                    }),
                                },
                            );

                            if (refreshRes.ok) {
                                const refreshed = await refreshRes.json() as {
                                    access_token: string;
                                };
                                accessToken = refreshed.access_token;
                                deauthRes = await fetch(
                                    "https://www.strava.com/oauth/deauthorize",
                                    {
                                        method: "POST",
                                        headers: {
                                            "Authorization":
                                                `Bearer ${accessToken}`,
                                        },
                                    },
                                );
                            }
                        } catch (refreshErr) {
                            console.error(
                                "Strava token refresh failed:",
                                refreshErr,
                            );
                        }
                    }
                }

                if (deauthRes && deauthRes.ok) {
                    console.log("Strava deauthorization successful");
                } else {
                    console.warn(
                        "Strava deauthorization may not have succeeded; proceeding with local deletion",
                    );
                }
            } catch (error) {
                console.error("Strava deauthorization error:", error);
                // Continue with deletion even if Strava deauth fails
            }
        }

        // Delete user data (this will cascade to related tables due to foreign key constraints)
        const { error: deleteError } = await supabase
            .from("users")
            .delete()
            .eq("id", tokenData.user_id);

        if (deleteError) {
            console.error("Failed to delete user data:", deleteError);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":
                        "https://www.reggie.run/preferences/error?error=" +
                        encodeURIComponent("Failed to delete account data"),
                },
            });
        }

        console.log(
            `✅ Successfully disconnected and deleted user: ${joinedUser?.email}`,
        );

        // Redirect to success page
        return new Response(null, {
            status: 302,
            headers: {
                "Location": "https://www.reggie.run/preferences/disconnected",
            },
        });
    } catch (error) {
        console.error("❌ Confirm disconnect error:", error);
        return new Response(null, {
            status: 302,
            headers: {
                "Location": "https://www.reggie.run/preferences/error?error=" +
                    encodeURIComponent("An unexpected error occurred"),
            },
        });
    }
});
