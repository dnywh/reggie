import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const REGGIE_URL = Deno.env.get("REGGIE_URL");
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

// Format pace from numeric minutes per km (e.g., 4.97) to time format (e.g., "4:56")
function formatPace(paceMinKm: number | null): string {
  if (paceMinKm === null || paceMinKm === undefined) {
    return "?";
  }

  const minutes = Math.floor(paceMinKm);
  const seconds = Math.round((paceMinKm - minutes) * 60);

  // Handle edge case where seconds round to 60
  if (seconds === 60) {
    return `${minutes + 1}:00`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Check if a run happened "yesterday" based on the run's actual timezone
function isRunFromYesterday(run: any, _userTimezone: string | null): boolean {
  if (!run.start_date_local || !run.timezone) {
    // Fallback: if no timezone data, assume it's not yesterday
    // (since we can't determine timezone accurately)
    console.log("No timezone data, assuming it's not yesterday");
    return false;
  }

  // Since start_date_local is now stored as local time (timestamp column),
  // we need to interpret it correctly in the run's timezone
  const runTimezone = run.timezone;

  // Parse the stored local time and treat it as if it's in the run's timezone
  // const runDate = new Date(run.start_date_local);
  const now = new Date();

  // Get "yesterday" in the run's timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: runTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Get yesterday's date in the run's timezone
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatter.format(yesterday);

  // For the run date, we need to interpret the stored local time in the run's timezone
  // Since it's stored as local time in format "2025-10-14T06:25:16", we can extract the date part
  const runDateStr = run.start_date_local.split("T")[0]; // Extract YYYY-MM-DD part

  console.log(
    `Date comparison: runDateStr: ${runDateStr}, yesterdayStr: ${yesterdayStr}`,
  );
  console.log(
    `Run details: start_date_local=${run.start_date_local}, timezone=${run.timezone}`,
  );

  return runDateStr === yesterdayStr;
}

// Check if it's currently morning in the user's timezone
function isMorningInTimezone(timezone: string | null): boolean {
  const now = new Date();

  if (!timezone) {
    const hour = now.getHours();
    console.log(`Hour (no timezone): ${hour}`);
    console.log(`Is early morning: ${hour >= 3 && hour < 6}`);
    return hour >= 3 && hour < 6;
  }

  // Use Intl.DateTimeFormat for reliable timezone conversion
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });

  const hour = parseInt(formatter.format(now));
  console.log(`Hour in ${timezone}: ${hour}`);
  console.log(`Is early morning: ${hour >= 3 && hour < 6}`);
  // Consider it "morning" between 2:00 AM and 6:00 AM local time
  // This ensures emails are sent before people typically run (around 7 AM)
  return hour >= 3 && hour < 6;
}

// Timezone-aware date calculation functions
function getDaysAgoInTimezone(
  timezone: string | null,
  daysAgo: number,
): string {
  const now = new Date();

  if (!timezone) {
    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - daysAgo);
    console.log({ pastDate });
    return pastDate.toISOString().slice(0, 10);
  }

  // Use proper timezone conversion to get the date in user's timezone
  // en-CA provides YYYY-MM-DD format
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const pastDate = new Date(now);
  pastDate.setDate(pastDate.getDate() - daysAgo);

  // Format the date in the user's timezone
  const formattedDate = formatter.format(pastDate);
  console.log({ pastDate, formattedDate });

  return formattedDate;
}

Deno.serve(async (_req: Request) => {
  // Parse headers for testing overrides
  // TODO: can't seem to get working
  // const skipMorningCheck = req.headers.get("skip_morning_check") === "true";
  const skipMorningCheck = false;
  // console.log({ skipMorningCheck });
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
      // 2️⃣ Get recent runs first to determine the most accurate timezone
      // Use user's timezone as fallback for date range calculation
      const daysAgoStr = getDaysAgoInTimezone(timezone, dateRange);
      console.log(`${email} – Date range query: >= ${daysAgoStr}T00:00:00`);

      const { data: recentRuns, error: recentRunsError } = await supabase.from(
        "runs",
      )
        .select(
          "start_date_local, timezone, distance_km, duration_min, avg_pace_min_km, rpe, notes",
        )
        .eq("user_id", user_id)
        .gte("start_date_local", daysAgoStr + "T00:00:00")
        .order("start_date_local", { ascending: false });

      console.log({ recentRuns });

      if (recentRunsError) {
        console.error(
          `${email} – Error fetching recent runs:`,
          recentRunsError,
        );
        continue;
      }

      // Determine the most accurate timezone: use most recent run's timezone if available, otherwise user's timezone
      const effectiveTimezone = recentRuns?.length > 0 && recentRuns[0].timezone
        ? recentRuns[0].timezone
        : timezone;

      console.log(
        `${email} – Using timezone: ${effectiveTimezone} (from ${
          recentRuns?.length > 0 ? "most recent run" : "user profile"
        })`,
      );

      // Skip users who aren't in their morning hours (3:00 AM - 6:00 AM local time)
      // UNLESS we're in testing mode with skip_morning_check=true
      if (!skipMorningCheck && !isMorningInTimezone(effectiveTimezone)) {
        console.log(
          `${email} – Skipping. Not early morning in their timezone (${effectiveTimezone})`,
        );
        continue;
      }

      // Log when morning check is skipped for testing
      if (skipMorningCheck) {
        console.log(
          `${email} – Morning check skipped for testing (skip_morning_check=true)`,
        );
      }

      // Get yesterday's runs specifically for email display
      // We'll filter these from recentRuns using the new timezone-aware logic
      const yesterdayRuns = recentRuns?.filter((run: any) =>
        isRunFromYesterday(run, effectiveTimezone)
      ) || [];

      console.log(`${email} – Yesterday's runs count: ${yesterdayRuns.length}`);

      // All users who are is_active should have a training plan
      // But just check anyway
      // TODO: separate flow to guide users through setting up a training plan
      if (!temp_training_plan) {
        console.log(`${email} – Missing training plan`);
        continue;
      }
      // Format yesterday's runs for email display (if any)
      const formattedYesterdayRuns = yesterdayRuns?.map((r: any) => {
        return `${r.distance_km ?? "?"} km in ${r.duration_min ?? "?"} min (${
          formatPace(r.avg_pace_min_km)
        }/km)`;
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
        } min (${formatPace(r.avg_pace_min_km)} min/km)`;
      }) || [];

      console.log(`${email} – Formatted recent runs: ${formattedRecentRuns}`);

      const greetingVariations = [
        "Alright",
        "Whats up",
        "Hey",
        "Morning",
        "Howdy",
      ];


      // 3️⃣ Prepare DeepSeek prompt
      const systemPrompt = `
You are Reggie the Numbat, a running coach who writes short, cheeky morning check-ins in Australian English.
Give one paragraph of advice for today based on the runner’s recent activity and their broader goals.
Use smart curly quotes (‘’ and “”) for quotation marks and apostrophes, not dumb straight quotes ('' and ""). Do not use em-dashes. 
Be liberal with line breaks for readability.
Be clear, concise, yet not robotic. Just a nice Numbat running coach.
`;
      // Prepare the user's training plan for the LLM user prompt
      const trainingPlanSection = temp_training_plan;
      // Prepare today's date in the user's timezone for the LLM user prompt
      const todayInUserTimezone = new Intl.DateTimeFormat("en-CA", {
        timeZone: effectiveTimezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date());

      const userPrompt = `
      TRAINING PLAN:
${trainingPlanSection}
---
TODAY'S DATE:
${todayInUserTimezone}.
---
RECENT ACTIVITY (last ${dateRange} days):
${formattedRecentRuns.join(", ")}
---
Give advice on exactly what to do today in regards to my training plan, taking into account my above recent activity.
If the training plan suggests a run, provide a specific distance and pace.
Start with a variation of "${greetingVariations[Math.floor(Math.random() * greetingVariations.length)]}, ${name || "mate"}.".
Keep it short (under 80 words). Use Australian English.
`;

      const subjectVariations = [
        "Morning, mate",
        "Rise and shine",
        "Good morning!",
        "Reggie here",
        "Checking in",
      ];

      const reachOutVariations = [
        "As always, flick me a reply if your plans change. I’ll tweak the schedule accordingly.",
        "Let me know if you have questions.",
        "Let me know if you need to change things up.",
        "Any changes, let me know.",
      ];

      const signOffVariations = [
        "Keep it up,",
        "I’m proud of you,",
        "Rock on,",
        "Cheers,",
        "Yours,",
      ];

      const nameVariations = [
        "Reg",
        "Reggie",
        "Reginald",
      ];

      const preferenceTextVariations = [
        "Let me know",
        "Edit your preferences",
      ];

      console.log(`${email} – User prompt:`, userPrompt);
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
          temperature: 1.1,
          max_tokens: 180,
        }),
      });
      const llmJson = await llmResponse.json() as any;
      // Get the LLM response or fall back to a generic message
      const advice = llmJson?.choices?.[0]?.message?.content?.trim() ??
        `<p>You’re doing great, ${
          name || "mate"
        }. Here are the latest numbers.</p>`;

      // Format advice text by wrapping each line in <p> tags
      const formattedAdvice = advice
        .split("\n")
        .filter((line: string) =>
          line.trim() !== ""
        ) // Remove empty lines
        .map((line: string) => `<p>${line.trim()}</p>`)
        .join("\n\n");

      const html = `
${formattedAdvice}
${
        yesterdayRuns?.length
          ? `
<p>Here's what you ran yesterday:</p>

<ul>
${formattedYesterdayRuns.map((r: string) => `<li>${r}</li>`)}
</ul>
`
          : ""
      }
<p>Here's the plan for the next few days:</p>

<ul>
<li>Today: TBD</li>
<li>Tomorrow: TBD</li>
<li>Friday: TBD</li>
<li>Saturday: TBD</li>
<li>Sunday: TBD</li>
</ul>

<p>${reachOutVariations[Math.floor(Math.random() * reachOutVariations.length)]}</p>

<p>${signOffVariations[Math.floor(Math.random() * signOffVariations.length)]
}</br>
${nameVariations[Math.floor(Math.random() * nameVariations.length)]}</p>

<p>---</p>

<p>P.S. am I emailing too much? Too little? <a href="${REGGIE_URL}/preferences?name=${name}&email=${email}">${preferenceTextVariations[Math.floor(Math.random() * preferenceTextVariations.length)]}</a>.</p>
`;

      // 6️⃣ Send via Resend
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          // Randomly select a subject variation (e.g. "Morning, mate. Reggie here")
          subject: subjectVariations[
            Math.floor(Math.random() * subjectVariations.length)
          ],
          html,
        });
        console.log(`${email} – Successfully sent morning review email!`);
        sentCount++;
      } catch (err) {
        console.error(`${email} – Failed to send email:`, err);
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
