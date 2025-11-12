import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const REGGIE_URL = Deno.env.get("REGGIE_URL");
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
const ASSISTANCE_EMAIL = Deno.env.get("ASSISTANCE_EMAIL");

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  console.log("🔍 Starting outbound-reply function");

  // Get all pending replies that haven't been sent yet
  const { data: pending, error } = await supabase.from("pending_replies")
    .select("*").eq("sent", false);

  if (error) {
    console.error("❌ Fetch error:", error);
    return new Response("Error", {
      status: 500,
    });
  }

  console.log(`📋 Found ${pending?.length || 0} pending replies`);

  for (const reply of pending ?? []) {
    try {
      console.log("🔄 Processing reply:", JSON.stringify(reply, null, 2));

      // Look up user to check if they're new or existing
      const { data: user, error: userError } = await supabase.from("users")
        .select("id, name, is_active")
        .eq("email", reply.email)
        .single();

      if (userError) {
        console.error(`❌ Failed to lookup user ${reply.email}:`, userError);
        continue;
      }

      console.log("👤 User found:", JSON.stringify(user, null, 2));

      // Determine if this is a new user (not active yet)
      const isNewUser = !user.is_active;
      console.log(`🎯 User type: ${isNewUser ? "NEW" : "EXISTING"}`);

      // Generate message content based on user status
      // Uses the /mobile/authorize endpoint to open in the Strava app if available
      const stravaUrl =
        `https://www.strava.com/oauth/mobile/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${
          encodeURIComponent(`${SUPABASE_URL}/functions/v1/strava-callback`)
        }&scope=read,activity:read_all&state=${
          encodeURIComponent(reply.email)
        }`;

      // Only send email to new users
      if (isNewUser) {
        const html = `
<p>G’day, Reggie here.</p>

<p>I’d be happy to help. The first step is hooking up to Strava so I can keep an eye on your runs. Let’s set it up now:</p>

<a href="${stravaUrl}">Connect with Strava</a>

<p>Cheers,<br />
Reg</p>

<p>---</p>

<p>P.S. you can disconnect or delete your data at any time. More info <a href="${REGGIE_URL}/strava">here</a>.</p>
`;

        console.log("📧 Sending email to:", reply.email);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: reply.email,
          subject: "Got it",
          html,
        });
      } else {
        console.log("⏭️ Skipping email to existing user (emailing Danny instead)");
      }

      console.log("✅ Marking reply as sent");
      await supabase.from("pending_replies").update({
        sent: true,
      }).eq("id", reply.id);

      console.log(
        `✅ Replied to ${reply.email} (${isNewUser ? "new" : "existing"} user)`,
      );

      // If the user is NOT new, assume they need a 'Wizard of Oz' style update
      // So send a notification email to Danny to let him work on it
      if (!isNewUser) {
        // DEBUG: Try to fetch the message content
        console.log(
          "🔍 Fetching message content for message_id:",
          reply.message_id,
        );
        const { data: message, error: messageError } = await supabase
          .from("messages")
          .select("id, subject, body")
          .eq("id", reply.message_id)
          .single();

        if (messageError) {
          console.log("❌ Message fetch error:", messageError);
        } else {
          console.log("✅ Message found:", JSON.stringify(message, null, 2));
        }

        console.log("📧 Sending notification email to Danny");
        await resend.emails.send({
          from: FROM_EMAIL,
          to: ASSISTANCE_EMAIL!,
          subject: `New reply from ${user.name || reply.email}`,
          html: `
            <p><strong>Name:</strong> ${user.name || "No name"}</p>
            <p><strong>Email:</strong> ${reply.email}</p>
            <p><strong>Message ID:</strong> ${message?.id}</p>
            <p><strong>Subject:</strong> ${message?.subject || "No subject"}</p>
            <p><strong>Body:</strong><br />
              <em>${message?.body || "No content"}</em>
           </p>
          `,
        });
        console.log(`✅ Sent notification email to Danny`);
      }
    } catch (err) {
      console.error(`❌ Failed to reply to ${reply.email}:`, err);
    }
  }

  console.log("🏁 Finished processing all replies");
  return new Response("OK");
});
