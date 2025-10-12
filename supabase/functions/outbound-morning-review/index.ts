import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
Deno.serve(async (_req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
  const FROM_EMAIL = "Reggie <me@reggie.run>";
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const resend = new Resend(RESEND_API_KEY);
  try {
    // 1️⃣ Get all active users
    const { data: users, error: usersError } = await supabase.from("users").select("id, email").eq("is_active", true);
    if (usersError) throw usersError;
    if (!users?.length) return new Response("No users", {
      status: 200
    });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().slice(0, 10);
    let sentCount = 0;
    for (const { id: user_id, email } of users){
      // 2️⃣ Get runs from yesterday
      const { data: runs, error: runsError } = await supabase.from("runs").select("date, distance_km, duration_min, avg_pace_min_km, rpe, notes").eq("user_id", user_id).eq("date", yDate).order("date", {
        ascending: false
      });
      if (runsError) {
        console.error(`Error fetching runs for ${email}:`, runsError);
        continue;
      }
      if (!runs?.length) {
        console.log(`No runs found for ${email} on ${yDate}`);
        continue;
      }
      const formattedRuns = runs.map((r)=>{
        return `${r.distance_km ?? "?"} km in ${r.duration_min ?? "?"} min (${r.avg_pace_min_km ?? "?"} min/km, RPE ${r.rpe ?? "?"})`;
      });
      // 3️⃣ Prepare DeepSeek prompt
      const systemPrompt = `
You are Reggie the Numbat, an Aussie running coach who writes short, cheeky morning check-ins.
You have to give one paragraph of advice based on a user's recent running activity.
Be conversational and motivational, not robotic.
`;
      const userPrompt = `
The runner is training for a half-marathon on **1 November 2025**.
Here’s their running activity from yesterday (${yDate}):

${formattedRuns.join("\n")}

Give a single friendly paragraph with advice on what to do today (e.g. rest, easy run, tempo, long run),
keeping them on track for the half-marathon. 
Keep it short (under 80 words). Use Australian English.
`;
      // 4️⃣ Call DeepSeek
      const llmResponse = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: userPrompt
            }
          ],
          temperature: 0.8,
          max_tokens: 180
        })
      });
      const llmJson = await llmResponse.json();
      const advice = llmJson?.choices?.[0]?.message?.content?.trim() ?? "Keep those legs ticking over, legend!";
      // 5️⃣ Combine with greeting
      const text = [
        `G’day legend,`,
        ``,
        `Here’s your running activity from yesterday (${yDate}):`,
        formattedRuns.map((r)=>`• ${r}`).join("\n"),
        ``,
        advice,
        ``,
        `Catch ya out there,`,
        `Reggie 🦘`
      ].join("\n");
      // 6️⃣ Send via Resend
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: "Your daily run summary from Reggie 🦘",
          text
        });
        console.log(`Sent to ${email}`);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send to ${email}:`, err);
      }
    }
    return new Response(JSON.stringify({
      sent: sentCount
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
