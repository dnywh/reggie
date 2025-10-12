import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

// Simple trend analysis for recent runs
function getTrendAnalysis(runs: any[]) {
  if (!runs || runs.length < 2) return "";

  const recent = runs.slice(0, 3); // Last 3 runs
  const older = runs.slice(3, 6); // Previous 3 runs

  if (recent.length === 0 || older.length === 0) return "";

  const recentAvgPace =
    recent.reduce((sum: number, r: any) => sum + (r.avg_pace_min_km || 0), 0) /
    recent.length;
  const olderAvgPace =
    older.reduce((sum: number, r: any) => sum + (r.avg_pace_min_km || 0), 0) /
    older.length;

  const recentDistance = recent.reduce(
    (sum: number, r: any) => sum + (r.distance_km || 0),
    0,
  );
  const olderDistance = older.reduce(
    (sum: number, r: any) => sum + (r.distance_km || 0),
    0,
  );

  const trends = [];
  if (recentAvgPace < olderAvgPace - 0.1) trends.push("pace improving");
  if (recentAvgPace > olderAvgPace + 0.1) trends.push("pace slowing");
  if (recentDistance > olderDistance + 2) trends.push("volume increasing");
  if (recentDistance < olderDistance - 2) trends.push("volume decreasing");

  return trends.length > 0 ? `Trends: ${trends.join(", ")}.` : "";
}
Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
  const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const resend = new Resend(RESEND_API_KEY);
  try {
    // 1️⃣ Get all active users
    const { data: users, error: usersError } = await supabase.from("users")
      .select("id, email, name").eq("is_active", true);
    if (usersError) throw usersError;
    if (!users?.length) {
      return new Response("No users", {
        status: 200,
      });
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().slice(0, 10);
    let sentCount = 0;
    const dateRange = 14;
    for (const { id: user_id, email, name } of users) {
      // 2️⃣ Get recent runs (last 14 days) for trend analysis
      // Could be shortened to last 7 days for brevity and context length
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - dateRange);
      const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10);

      const { data: recentRuns, error: recentRunsError } = await supabase.from(
        "runs",
      )
        .select("date, distance_km, duration_min, avg_pace_min_km, rpe, notes")
        .eq("user_id", user_id)
        .gte("date", fourteenDaysAgoStr)
        .order("date", { ascending: false });

      if (recentRunsError) {
        console.error(
          `Error fetching recent runs for ${email}:`,
          recentRunsError,
        );
        continue;
      }

      // Get yesterday's runs specifically for email display
      const { data: yesterdayRuns, error: yesterdayRunsError } = await supabase
        .from("runs")
        .select("date, distance_km, duration_min, avg_pace_min_km, rpe, notes")
        .eq("user_id", user_id)
        .eq("date", yDate)
        .order("date", { ascending: false });

      if (yesterdayRunsError) {
        console.error(
          `Error fetching yesterday's runs for ${email}:`,
          yesterdayRunsError,
        );
        continue;
      }

      if (!yesterdayRuns?.length) {
        console.log(`No runs found for ${email} on ${yDate}`);
        continue;
      }

      // Format yesterday's runs for email display
      const formattedYesterdayRuns = yesterdayRuns.map((r: any) => {
        return `${r.distance_km ?? "?"} km in ${r.duration_min ?? "?"} min (${
          r.avg_pace_min_km ?? "?"
        } min/km, RPE ${r.rpe ?? "?"})`;
      });

      // Format recent runs for LLM context (with days ago)
      const formattedRecentRuns = recentRuns?.map((r: any, _i: number) => {
        const runDate = new Date(r.date);
        const daysAgo = Math.floor(
          (new Date().getTime() - runDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const dayLabel = daysAgo === 0
          ? "today"
          : daysAgo === 1
          ? "yesterday"
          : `${daysAgo} days ago`;
        return `${dayLabel}: ${r.distance_km ?? "?"} km in ${
          r.duration_min ?? "?"
        } min (${r.avg_pace_min_km ?? "?"} min/km, RPE ${r.rpe ?? "?"})`;
      }) || [];
      // 3️⃣ Prepare DeepSeek prompt
      const systemPrompt = `
You are Reggie the Numbat, an Aussie running coach who writes short, cheeky morning check-ins.
You have to give one paragraph of advice for today based on the runner's recent activity and their broader goals.
Be conversational, fun, and motivational, yet non-cheesy, not over-the-top on Australian slang, and not robotic.
`;
      const userPrompt = `
This runner is training for a half-marathon on **1 November 2025** (goal: ~1:55-2:00 finish).

TRAINING PROGRAM OVERVIEW:
- 3-week program: Week 1 (build to 30-32km), Week 2 (peak 35-37km), Week 3 (taper 22-23km)
- Key runs: Parkrun 5km (fast, 4:10-4:20/km) Saturdays, Community 5km (steady, 4:50-5:00/km) Tuesdays
- Long run: 12km (Week 1) → 15-16km (Week 2) → taper
- Target paces: Easy 5:15-5:40/km, Steady 4:50-5:00/km, Fast 4:10-4:20/km, Long 5:30-6:00/km
- Sunday = rest day, Thursday = rest day

RECENT ACTIVITY (last ${dateRange} days):
${formattedRecentRuns.join("\n")}

${getTrendAnalysis(recentRuns)}

Give a single friendly paragraph with advice on exactly what to do today,
keeping them on track for their training goals. It might be a run or rest day.
If it's a run, give a specific pace, effort level, and distance.
Your paragraph will be sandwiched between "G'day, ${
        name || "mate"
      }. Reggie here." and "Keep it up, Reggie". Therefore do not include an intro or sign-off.
Keep it short (under 80 words). Use Australian English. 
`;
      // 4️⃣ Call DeepSeek
      const llmResponse = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
          temperature: 0.8,
          max_tokens: 180,
        }),
      });
      const llmJson = await llmResponse.json() as any;
      const advice = llmJson?.choices?.[0]?.message?.content?.trim() ??
        "You're doing great.";
      // 5️⃣ Combine with greeting
      const text = [
        `G'day, ${name || "mate"}. Reggie here.`,
        ``,
        advice,
        ``,
        `Here's the full breakdown of yesterday's runs:`,
        ``,
        formattedYesterdayRuns.map((r: string) => `– ${r}`).join("\n"),
        ``,
        `And what’s coming up this week:`,
        ``,
        `– TODO`,
        ``,
        `As always, just flick me a reply if your plans change. We can adapt the schedule accordingly.`,
        ``,
        `Keep it up,`,
        `Reg`,
      ].join("\n");
      // 6️⃣ Send via Resend
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: "Morning, mate",
          text,
        });
        console.log(`Sent to ${email}`);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send to ${email}:`, err);
      }
    }
    return new Response(
      JSON.stringify({
        sent: sentCount,
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({
        error: String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
});
