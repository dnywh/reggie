import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  // Checks for pending replies that haven't been sent in the last 5 minutes
  // As in, we only reply to messages that were received more than 5 minutes ago
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabase.from("pending_replies")
    .select("*").eq("sent", false).lt("created_at", fiveMinutesAgo);
  if (error) {
    console.error("Fetch error:", error);
    return new Response("Error", {
      status: 500,
    });
  }
  for (const reply of pending ?? []) {
    try {
      // Look up user to check if they're new or existing
      const { data: user, error: userError } = await supabase.from("users")
        .select("id, name, is_active")
        .eq("email", reply.email)
        .single();

      if (userError) {
        console.error(`Failed to lookup user ${reply.email}:`, userError);
        continue;
      }

      // Determine if this is a new user (not active yet)
      const isNewUser = !user.is_active;

      // Generate message content based on user status
      const stravaUrl =
        `https://www.strava.com/oauth/authorize?client_id=19982&response_type=code&redirect_uri=${
          encodeURIComponent(`${SUPABASE_URL}/functions/v1/strava-callback`)
        }&scope=read,activity:read_all&state=${
          encodeURIComponent(reply.email)
        }`;

      const messageContent = isNewUser
        ? [
          "G’day, Reggie here.",
          "",
          "Thanks for emailing. I’d be happy to help.",
          "",
          "The first step is connecting to Strava so I can keep an eye on your runs. Don’t worry, you can upload them as ‘private’ and they’ll still come through to me. You can also disconnect at any time.",
          "",
          "Let’s set it up now. Just click this link to tell Strava to share your runs with me:",
          stravaUrl,
          "",
          `My human assistant Danny (${
            Deno.env.get("ASSISTANCE_EMAIL")
          }) is around if you have any questions.`,
          "",
          "Cheers,",
          "Reg",
        ]
        : [
          `Hey ${user.name || "mate"}, got your email.`,
          "",
          `I’ll get back to you soon with a proper response. You can also flick my human assistant, Danny, an email (${
            Deno.env.get("ASSISTANCE_EMAIL")
          }) if you need help with something other than your training program.`,
          "",
          "Cheers,",
          "Reg",
        ];

      await resend.emails.send({
        from: FROM_EMAIL,
        to: reply.email,
        subject: "Got it",
        text: messageContent.join("\n"),
      });

      await supabase.from("pending_replies").update({
        sent: true,
      }).eq("id", reply.id);

      console.log(
        `✅ Replied to ${reply.email} (${isNewUser ? "new" : "existing"} user)`,
      );
    } catch (err) {
      console.error(`Failed to reply to ${reply.email}:`, err);
    }
  }
  return new Response("OK");
});
