import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
const ASSISTANCE_EMAIL = Deno.env.get("ASSISTANCE_EMAIL");

Deno.serve(async (req: Request) => {
    try {
        if (req.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
        }

        const { name, email } = await req.json();

        // Validate required parameters (only email is required)
        if (!email) {
            return new Response(
                JSON.stringify({ error: "Missing email parameter" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
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
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        const supabase = createClient(
            SUPABASE_URL!,
            SUPABASE_SERVICE_ROLE_KEY!,
        );

        // Validate user exists
        const { data: user, error: userError } = await supabase
            .from("users")
            .select(
                "id, name, email, timezone, created_at, is_active",
            )
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
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        // Use provided name or fall back to stored name
        const displayName = name || user.name || "there";

        // Send notification email to Danny (assistance email)
        const notificationContent = [
            "Data Access Request",
            "",
            `User: ${displayName} (${user.email})`,
            `Timezone: ${user.timezone}`,
            `Account Created: ${user.created_at}`,
            `Active: ${user.is_active ? "Yes" : "No"}`,
            "",
            "Please prepare and send the user's data within 24 hours.",
            "",
            "User data includes:",
            "- Profile information (name, email, timezone)",
            "- Strava connection status",
            "- Training preferences and history",
            "- Email interaction logs",
        ].join("\n");

        await resend.emails.send({
            from: FROM_EMAIL,
            to: ASSISTANCE_EMAIL,
            subject: `Data Access Request - ${user.name}`,
            text: notificationContent,
        });

        // Send confirmation email to user
        const userConfirmationContent = [
            `G'day ${displayName},`,
            "",
            "We've received your request for a copy of your data.",
            "",
            "We'll prepare and email you a copy of all the data Reggie has stored about you within 24 hours.",
            "",
            "This includes:",
            "- Your profile information",
            "- Strava connection details",
            "- Training preferences and history",
            "- Email interaction logs",
            "",
            "If you have any questions, feel free to reply to this email.",
            "",
            "Cheers,",
            "Reg",
        ].join("\n");

        await resend.emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: "Data Access Request Received",
            text: userConfirmationContent,
        });

        console.log(`✅ Data request processed for user: ${email}`);

        return new Response(
            JSON.stringify({
                success: true,
                message: "Data request submitted successfully",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("❌ Data request error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
});
