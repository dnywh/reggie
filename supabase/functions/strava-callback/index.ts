import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Initialise Supabase client (service role key)
const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Your Strava app credentials
const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;

// Simple country-based timezone detection
function getTimezoneFromCountry(country: string): string | null {
    const countryLower = country.toLowerCase();

    // Handle common country name variations
    if (countryLower.includes("australia")) return "Australia/Sydney";
    if (
        countryLower.includes("united states") || countryLower.includes("usa")
    ) return "America/New_York";
    if (
        countryLower.includes("united kingdom") || countryLower.includes("uk")
    ) return "Europe/London";
    if (countryLower.includes("canada")) return "America/Toronto";
    if (countryLower.includes("germany")) return "Europe/Berlin";
    if (countryLower.includes("france")) return "Europe/Paris";
    if (countryLower.includes("japan")) return "Asia/Tokyo";
    if (countryLower.includes("singapore")) return "Asia/Singapore";
    if (countryLower.includes("new zealand")) return "Pacific/Auckland";
    if (countryLower.includes("netherlands")) return "Europe/Amsterdam";
    if (countryLower.includes("spain")) return "Europe/Madrid";
    if (countryLower.includes("italy")) return "Europe/Rome";
    if (countryLower.includes("sweden")) return "Europe/Stockholm";
    if (countryLower.includes("norway")) return "Europe/Oslo";
    if (countryLower.includes("denmark")) return "Europe/Copenhagen";
    if (countryLower.includes("brazil")) return "America/Sao_Paulo";
    if (countryLower.includes("mexico")) return "America/Mexico_City";
    if (countryLower.includes("south africa")) return "Africa/Johannesburg";
    if (countryLower.includes("india")) return "Asia/Kolkata";
    if (countryLower.includes("china")) return "Asia/Shanghai";
    if (countryLower.includes("south korea")) return "Asia/Seoul";
    if (countryLower.includes("hong kong")) return "Asia/Hong_Kong";

    return null; // Fall back to UTC
}

console.info("🦘 Reggie's Strava callback running...");

Deno.serve(async (req: Request) => {
    try {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state"); // this is the user's email
        const error = url.searchParams.get("error");

        // Handle Strava authorization errors
        if (error) {
            console.error("Strava authorization error:", error);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location": `https://www.reggie.run/strava/error?error=${
                        encodeURIComponent(error)
                    }`,
                },
            });
        }

        if (!code || !state) {
            console.error("Missing required parameters:", {
                code: !!code,
                state: !!state,
            });
            return new Response(null, {
                status: 302,
                headers: {
                    "Location": `https://www.reggie.run/strava/error?error=${
                        encodeURIComponent(
                            "Missing authorization code or email",
                        )
                    }`,
                },
            });
        }

        // Validate email format in state parameter
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(state)) {
            console.error("Invalid email format in state:", state);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location": `https://www.reggie.run/strava/error?error=${
                        encodeURIComponent("Invalid email format")
                    }`,
                },
            });
        }

        // 1️⃣ Exchange code for tokens
        const tokenRes = await fetch("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            console.error("Token exchange failed:", {
                status: tokenRes.status,
                error: errText,
            });
            throw new Error(`Failed to exchange code: ${errText}`);
        }

        const data = await tokenRes.json() as {
            access_token: string;
            refresh_token: string;
            expires_at: number;
            athlete?: {
                firstname?: string;
                lastname?: string;
                city?: string;
                country?: string;
            };
        };

        // Validate required token data
        if (!data.access_token || !data.refresh_token || !data.expires_at) {
            console.error("Invalid token response:", data);
            throw new Error("Invalid token response from Strava");
        }

        // 2️⃣ Prepare updates for the user
        const expiresIso = new Date(data.expires_at * 1000).toISOString();
        const name = data.athlete?.firstname ?? null;

        // Determine timezone based on athlete's location
        let timezone: string | null = null;
        if (data.athlete?.country) {
            // Try to map country to timezone
            timezone = getTimezoneFromCountry(data.athlete.country);

            // If mapping fails, fall back to UTC
            if (!timezone) {
                console.log(
                    `No timezone mapping found for ${data.athlete.country}, falling back to UTC`,
                );
                timezone = "UTC";
            }
        }

        // 3️⃣ First check if user exists, then update the user record in Supabase by email
        const { data: _existingUser, error: lookupError } = await supabase
            .from("users")
            .select("id, email")
            .eq("email", state)
            .single();

        if (lookupError) {
            console.error("User lookup failed:", lookupError);
            return new Response(null, {
                status: 302,
                headers: {
                    "Location": `https://www.reggie.run/strava/error?error=${
                        encodeURIComponent(
                            "User not found. Please email Reggie first to get started.",
                        )
                    }`,
                },
            });
        }

        const { error: updateError } = await supabase
            .from("users")
            .update({
                strava_access_token: data.access_token,
                strava_refresh_token: data.refresh_token,
                strava_token_expires_at: expiresIso,
                name,
                timezone,
                is_active: true,
            })
            .eq("email", state);

        if (updateError) {
            console.error("Database update failed:", updateError);
            throw new Error(`Failed to update user: ${updateError.message}`);
        }

        // 4️⃣ Redirect to success page
        console.log(`✅ Successfully connected Strava for user: ${state}`);
        return new Response(null, {
            status: 302,
            headers: {
                "Location": "https://www.reggie.run/strava/success",
            },
        });
    } catch (err) {
        console.error("❌ Strava callback error:", err);
        const errorMessage = err instanceof Error
            ? err.message
            : "Unknown error occurred";
        return new Response(null, {
            status: 302,
            headers: {
                "Location": `https://www.reggie.run/strava/error?error=${
                    encodeURIComponent(errorMessage)
                }`,
            },
        });
    }
});
