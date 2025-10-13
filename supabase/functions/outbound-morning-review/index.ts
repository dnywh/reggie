import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

// Check if a run happened "yesterday" based on the run's actual timezone
function isRunFromYesterday(run: any, _userTimezone: string | null): boolean {
  if (!run.start_date_local || !run.timezone) {
    // Fallback: if no timezone data, assume it's not yesterday
    // (since we can't determine timezone accurately)
    return false;
  }

  // Use the run's actual timezone to determine if it was yesterday
  const runDate = new Date(run.start_date_local);
  const now = new Date();

  // Get "yesterday" in the run's timezone
  const runTimezone = run.timezone;
  const yesterdayInRunTimezone = new Date(
    now.toLocaleString("en-US", { timeZone: runTimezone }),
  );
  yesterdayInRunTimezone.setDate(yesterdayInRunTimezone.getDate() - 1);

  // Compare dates
  const runDateStr = runDate.toISOString().slice(0, 10);
  const yesterdayStr = yesterdayInRunTimezone.toISOString().slice(0, 10);

  return runDateStr === yesterdayStr;
}

// Check if it's currently morning in the user's timezone
function isMorningInTimezone(timezone: string | null): boolean {
  const now = new Date();
  const userDate = timezone
    ? new Date(now.toLocaleString("en-US", { timeZone: timezone }))
    : now;

  const hour = userDate.getHours();
  // Consider it "morning" between 2:00 AM and 6:00 AM local time
  // This ensures emails are sent before people typically run (around 7 AM)
  return hour >= 2 && hour < 6;
}

// Timezone-aware date calculation functions

function getDaysAgoInTimezone(
  timezone: string | null,
  daysAgo: number,
): string {
  const now = new Date();
  const userDate = timezone
    ? new Date(now.toLocaleString("en-US", { timeZone: timezone }))
    : now;

  const pastDate = new Date(userDate);
  pastDate.setDate(pastDate.getDate() - daysAgo);

  return pastDate.toISOString().slice(0, 10);
}

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
      .select("id, email, name, temp_training_plan, timezone").eq(
        "is_active",
        true,
      );
    if (usersError) throw usersError;
    if (!users?.length) {
      return new Response("No users", {
        status: 200,
      });
    }
    let sentCount = 0;
    const dateRange = 14;
    for (
      const { id: user_id, email, name, temp_training_plan, timezone } of users
    ) {
      // Skip users who aren't in their morning hours (2:00 AM - 6:00 AM local time)
      if (!isMorningInTimezone(timezone)) {
        console.log(`Skipping ${email} - not morning in their timezone`);
        continue;
      }

      // 2️⃣ Get recent runs (last 14 days) for trend analysis
      // Could be shortened to last 7 days for brevity and context length
      const daysAgoStr = getDaysAgoInTimezone(timezone, dateRange);

      const { data: recentRuns, error: recentRunsError } = await supabase.from(
        "runs",
      )
        .select(
          "start_date_local, timezone, distance_km, duration_min, avg_pace_min_km, rpe, notes",
        )
        .eq("user_id", user_id)
        .gte("start_date_local", daysAgoStr + "T00:00:00Z")
        .order("start_date_local", { ascending: false });

      if (recentRunsError) {
        console.error(
          `Error fetching recent runs for ${email}:`,
          recentRunsError,
        );
        continue;
      }

      // Get yesterday's runs specifically for email display
      // We'll filter these from recentRuns using the new timezone-aware logic
      const yesterdayRuns = recentRuns?.filter((run: any) =>
        isRunFromYesterday(run, timezone)
      ) || [];

      // All users who are is_active should have a training plan
      // But just check anyway
      // TODO: separate flow to guide users through setting up a training plan
      if (!temp_training_plan) {
        console.log(`Missing training plan for ${email}`);
        continue;
      }
      // Format yesterday's runs for email display (if any)
      const formattedYesterdayRuns = yesterdayRuns?.map((r: any) => {
        return `${r.distance_km ?? "?"} km in ${r.duration_min ?? "?"} min (${
          r.avg_pace_min_km ?? "?"
        } min/km, RPE ${r.rpe ?? "?"})`;
      }) || [];

      // Format recent runs for LLM context (with days ago)
      const formattedRecentRuns = recentRuns?.map((r: any, _i: number) => {
        const runDate = new Date(r.start_date_local);
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
Break it out into multiple lines (with empty lines between them) if necessary.
Be conversational, fun, and motivational, yet non-cheesy, not over-the-top on Australian slang, and not robotic.
Use curly quotes, not straight quotes. Avoid em-dashes.
`;
      // Use the user's training plan
      const trainingPlanSection = temp_training_plan;

      const userPrompt = `
${trainingPlanSection}

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
        "You’re doing great.";
      // 5️⃣ Combine with greeting
      const text = [
        `G’day, ${name || "mate"}. Reggie here.`,
        ``,
        advice,
        ``,
        ...(yesterdayRuns?.length
          ? [
            `Here’s what you ran yesterday:`,
            ``,
            formattedYesterdayRuns.map((r: string) => `– ${r}`).join("\n"),
            ``,
          ]
          : []),
        `${
          yesterdayRuns?.length ? "And here’s" : "Here’s"
        } what's coming up this week:`,
        ``,
        `– TODO: Upcoming items from your training plan will go here`,
        ``,
        `As always, flick me a reply if your plans change. We can adapt the schedule accordingly.`,
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
