import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  // Get all pending replies that haven't been sent yet
  const { data: pending, error } = await supabase.from("pending_replies")
    .select("*").eq("sent", false);
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
      // TODO: Test https://www.strava.com/oauth/mobile/authorize. Does it open in the Strava app?
      const stravaUrl =
        `https://www.strava.com/oauth/authorize?client_id=19982&response_type=code&redirect_uri=${
          encodeURIComponent(`${SUPABASE_URL}/functions/v1/strava-callback`)
        }&scope=read,activity:read_all&state=${
          encodeURIComponent(reply.email)
        }`;

      const html = isNewUser
        ? `
          <p>G’day, Reggie here.</p>
          <p>Thanks for emailing. I’d be happy to help.</p>
          <p>The first step is connecting to Strava so I can keep an eye on your runs. Don’t worry, you can upload them as ‘private’. They’ll still come through to me. Let’s set it up now.</p>

          <a href="${stravaUrl}" style="display: block; margin-left: max(24px, 1em);">
          <img src="${SUPABASE_URL}/storage/v1/object/public/static/strava-connect.png" 
              alt="Connect with Strava" 
              style="width: auto; height: 40px;" />
          </a>
        
          <p>You can disconnect or delete your data at any time. My human assistant Danny (<a href="mailto:${
          Deno.env.get("ASSISTANCE_EMAIL")
        }?subject=Hey Danny, I need help">${
          Deno.env.get("ASSISTANCE_EMAIL")
        }</a>) is around if you have any questions.</p>
          <p>Cheers,<br />
          Reg</p>
          
           <p>If that button didn’t work, try tapping <a href="${stravaUrl}">here</a> instead.</p>
        `
        : `
          <p>Hey ${user.name || "mate"}, confirming that I got your email.</p>
          <p>I’ll get back to you soon with a proper response. You can also flick an email to my human assistant Danny (<a href="mailto:${
          Deno.env.get("ASSISTANCE_EMAIL")
        }?subject=Hey Danny, I need help">${
          Deno.env.get("ASSISTANCE_EMAIL")
        }</a>) if you need help with something other than your training program.</p>
          <p>Cheers,<br />
          Reg</p>
        `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to: reply.email,
        subject: "Got it",
        html,
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
