import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = "Reggie <me@reggie.run>";
Deno.serve(async ()=>{
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabase.from("pending_replies").select("*").eq("sent", false).lt("created_at", fiveMinutesAgo);
  if (error) {
    console.error("Fetch error:", error);
    return new Response("Error", {
      status: 500
    });
  }
  for (const reply of pending ?? []){
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: reply.email,
        subject: "Got your message!",
        text: [
          "Hey mate,",
          "",
          "Reggie here. Just letting you know your message landed safely.",
          "I’ll get back to you soon.",
          "",
          "— Reggie 🐜"
        ].join("\n")
      });
      await supabase.from("pending_replies").update({
        sent: true
      }).eq("id", reply.id);
      console.log(`✅ Replied to ${reply.email}`);
    } catch (err) {
      console.error(`Failed to reply to ${reply.email}:`, err);
    }
  }
  return new Response("OK");
});
