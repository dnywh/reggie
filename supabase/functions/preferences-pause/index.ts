import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;

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
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        // Use provided name or fall back to stored name
        const displayName = name || user.name || "there";

        // Generate unique token
        const token = crypto.randomUUID();

        // Store token in database
        const { error: tokenError } = await supabase
            .from("preference_tokens")
            .insert({
                token,
                user_id: user.id,
                action: "pause",
            });

        if (tokenError) {
            console.error("Token storage failed:", tokenError);
            return new Response(
                JSON.stringify({
                    error: "Failed to generate confirmation token",
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        // Send confirmation email
        const confirmationUrl =
            `${SUPABASE_URL}/functions/v1/preferences-confirm-pause?token=${token}`;

        const emailContent = [
            `G'day ${displayName},`,
            "",
            "You've requested to pause Reggie's daily training emails.",
            "",
            "To confirm this action, please click the link below:",
            confirmationUrl,
            "",
            "This link will expire in 24 hours.",
            "",
            "If you didn't request this change, you can safely ignore this email.",
            "",
            "Cheers,",
            "Reg",
        ].join("\n");

        await resend.emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: "Confirm: Pause Reggie's emails",
            text: emailContent,
        });

        console.log(`✅ Pause confirmation email sent to ${email}`);

        return new Response(
            JSON.stringify({
                success: true,
                message: "Confirmation email sent",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    } catch (error) {
        console.error("❌ Pause preferences error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        );
    }
});
