import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const VALID_DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];

Deno.serve(async (req: Request) => {
    try {
        // Handle CORS preflight requests
        if (req.method === "OPTIONS") {
            return new Response("ok", { headers: corsHeaders });
        }

        if (req.method !== "POST") {
            return new Response("Method not allowed", {
                status: 405,
                headers: corsHeaders,
            });
        }

        const { name, email, frequency } = await req.json();

        // Validate required parameters
        if (!email) {
            return new Response(
                JSON.stringify({ error: "Missing email parameter" }),
                {
                    status: 400,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                },
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return new Response(
                JSON.stringify({ error: "Invalid email format" }),
                {
                    status: 400,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                },
            );
        }

        // Validate frequency parameter
        if (!frequency) {
            return new Response(
                JSON.stringify({ error: "Missing frequency parameter" }),
                {
                    status: 400,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                },
            );
        }

        // Validate frequency value
        let normalizedFrequency: string;
        if (frequency === "daily") {
            normalizedFrequency = "daily";
        } else {
            // Parse comma-separated day names
            const days = frequency
                .split(",")
                .map((day: string) => day.trim().toLowerCase())
                .filter((day: string) => day.length > 0);

            // Validate all days are valid
            const invalidDays = days.filter(
                (day: string) => !VALID_DAYS.includes(day),
            );
            if (invalidDays.length > 0) {
                return new Response(
                    JSON.stringify({
                        error: `Invalid day names: ${invalidDays.join(", ")}`,
                    }),
                    {
                        status: 400,
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json",
                        },
                    },
                );
            }

            // Remove duplicates and sort
            const uniqueDays = [...new Set(days)].sort();
            normalizedFrequency = uniqueDays.join(",");
        }

        const supabase = createClient(
            SUPABASE_URL!,
            SUPABASE_SERVICE_ROLE_KEY!,
        );

        // Validate user exists
        const { data: user, error: userError } = await supabase
            .from("users")
            .select("id, name, email")
            .eq("email", email)
            .single();

        if (userError || !user) {
            console.error("User validation failed:", userError);
            return new Response(
                JSON.stringify({
                    error: "User not found",
                }),
                {
                    status: 404,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                },
            );
        }

        // Update user's frequency preference
        const { error: updateError } = await supabase
            .from("users")
            .update({ morning_review_frequency: normalizedFrequency })
            .eq("id", user.id);

        if (updateError) {
            console.error("Frequency update failed:", updateError);
            return new Response(
                JSON.stringify({
                    error: "Failed to update frequency preference",
                }),
                {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                    },
                },
            );
        }

        console.log(
            `✅ Frequency preference updated for ${email}: ${normalizedFrequency}`,
        );

        return new Response(
            JSON.stringify({
                success: true,
                message: "Frequency preference updated",
                frequency: normalizedFrequency,
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    } catch (error) {
        console.error("❌ Update frequency error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    }
});

