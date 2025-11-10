import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
const REGGIE_URL = Deno.env.get("REGGIE_URL");
const OPENAI_API_URL = Deno.env.get("OPENAI_API_URL");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL");

// Temporary token to view the training plan
// Should be stored in the database and associated with the user for privacy
const trainingPlanToken = crypto.randomUUID();

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

// Format duration from numeric minutes (e.g., 25.8) to time format (e.g., "25m 40s")
function formatDuration(durationMin: number | null): string {
  if (durationMin === null || durationMin === undefined) {
    return "?";
  }

  const minutes = Math.floor(durationMin);
  const seconds = Math.round((durationMin - minutes) * 60);

  // Handle edge case where seconds round to 60
  if (seconds === 60) {
    return `${minutes + 1}m 0s`;
  }

  return `${minutes}m ${seconds}s`;
}

// Helper function to create a date formatter for timezone-aware date formatting
function createDateFormatter(timezone: string | null) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Helper function to randomly select from an array
function randomSelect<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

// Helper function to format additional run metrics
function formatAdditionalMetrics(
  elevation: number | null,
  avgHr: number | null,
  maxHr: number | null,
  sufferScore: number | null,
): string {
  const metrics: string[] = [];

  if (elevation !== null && elevation > 0) {
    metrics.push(`${Math.round(elevation)}m elevation`);
  }

  if (avgHr !== null && maxHr !== null) {
    metrics.push(`avg HR ${Math.round(avgHr)}, max ${Math.round(maxHr)}`);
  } else if (avgHr !== null) {
    metrics.push(`avg HR ${Math.round(avgHr)}`);
  } else if (maxHr !== null) {
    metrics.push(`max HR ${Math.round(maxHr)}`);
  }

  if (sufferScore !== null && sufferScore > 0) {
    metrics.push(`intensity ${Math.round(sufferScore)}`);
  }

  return metrics.length > 0 ? ` (${metrics.join(", ")})` : "";
}

// Check if it's currently morning in the user's timezone
function isMorningInTimezone(timezone: string | null): boolean {
  const now = new Date();

  if (!timezone) {
    const hour = now.getHours();
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
  // Consider it "morning" between 3:00 AM and 6:00 AM local time
  // This ensures emails are sent before people start their morning run
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
  const formatter = createDateFormatter(timezone);

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
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
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
      // 2️⃣ Get recent activities first to determine the most accurate timezone
      // Use user's timezone as fallback for date range calculation
      const daysAgoStr = getDaysAgoInTimezone(timezone, dateRange);
      console.log(`${email} – Date range query: >= ${daysAgoStr}T00:00:00`);

      const { data: recentActivities, error: recentActivitiesError } = await supabase.from(
        "activities",
      )
        .select(
          "start_date_local, timezone, type, distance_km, duration_min, avg_pace_min_km, total_elevation_gain, average_heartrate, max_heartrate, suffer_score",
        )
        .eq("user_id", user_id)
        .gte("start_date_local", daysAgoStr + "T00:00:00")
        .order("start_date_local", { ascending: false });

      console.log({ recentActivities });

      if (recentActivitiesError) {
        console.error(
          `${email} – Error fetching recent activities:`,
          recentActivitiesError,
        );
        continue;
      }

      // Determine the most accurate timezone: use most recent activity's timezone if available, otherwise user's timezone
      const effectiveTimezone = recentActivities?.length > 0 && recentActivities[0].timezone
        ? recentActivities[0].timezone
        : timezone;

      console.log(
        `${email} – Using timezone: ${effectiveTimezone} (from ${
          recentActivities?.length > 0 ? "most recent activity" : "user profile"
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
          `${email} – Morning check skipped for testing`,
        );
      }

      // All users who are is_active should have a training plan
      // But just check anyway
      // TODO: separate flow to guide users through setting up a training plan
      if (!temp_training_plan) {
        console.log(`${email} – Missing training plan`);
        continue;
      }

      // Format recent activities for LLM context (with days ago and activity type), timezone-aware
      const formattedRecentActivities = recentActivities?.map(
        (
          r: {
            start_date_local: string;
            type: string;
            distance_km: number | null;
            duration_min: number | null;
            avg_pace_min_km: number | null;
            total_elevation_gain: number | null;
            average_heartrate: number | null;
            max_heartrate: number | null;
            suffer_score: number | null;
          },
          _i: number,
        ) => {
          if (!r.start_date_local || !effectiveTimezone) {
            return `${r.distance_km ?? "?"}km ${r.type.toLowerCase()} in ${
              formatDuration(r.duration_min)
            } (${formatPace(r.avg_pace_min_km)}/km)${
              formatAdditionalMetrics(
                r.total_elevation_gain,
                r.average_heartrate,
                r.max_heartrate,
                r.suffer_score,
              )
            }`;
          }

          // Get today's date in the user's timezone
          const formatter = createDateFormatter(effectiveTimezone);

          const todayStr = formatter.format(new Date());
          const activityDateStr = r.start_date_local.split("T")[0]; // Extract YYYY-MM-DD part

          // Calculate days difference
          const today = new Date(todayStr);
          const activityDate = new Date(activityDateStr);
          const daysAgo = Math.floor(
            (today.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24),
          );

          const dayLabel = daysAgo === 0
            ? "today"
            : daysAgo === 1
            ? "yesterday"
            : `${daysAgo} days ago`;

          return `${dayLabel}: ${r.distance_km ?? "?"}km ${r.type.toLowerCase()} in ${
            formatDuration(r.duration_min)
          } (${formatPace(r.avg_pace_min_km)}/km)${
            formatAdditionalMetrics(
              r.total_elevation_gain,
              r.average_heartrate,
              r.max_heartrate,
              r.suffer_score,
            )
          }`;
        },
      ) || [];

      console.log(`${email} – Formatted recent activities: ${formattedRecentActivities}`);

      const greetingVariations = [
        "Alright",
        "Whats up",
        "Hey",
        "Morning",
        "Howdy",
      ];

      // 3️⃣ Prepare prompt
      const systemPrompt = `
You are Reggie the Numbat, a running coach who writes short, cheeky morning check-ins in Australian English.
Use smart curly quotes (‘’ and “”) for quotation marks and apostrophes, not dumb straight quotes ('' and ""). Do not use em-dashes. 
Be liberal with line breaks for readability.
Keep responses conversational and under 100 words.
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
TODAY’S DATE:
${todayInUserTimezone}.
---
RECENT ACTIVITY (last ${dateRange} days):
${formattedRecentActivities.join(", ")}
---
Start with "${randomSelect(greetingVariations)}, ${name || "mate"}.".
Give brief feedback on my recent activity, if any.
Give advice on exactly what to do today in regards to my training plan you created for me, taking into account my recent activity.
If the training plan suggests a run, provide a specific distance and target pace.
You can specify high-level negative splits if applicable.
`;

      const subjectVariations = [
        "Morning, mate",
        "Rise and shine",
        "Good morning!",
        "Reggie here",
        "Checking in",
      ];

      const reachOutVariations = [
        "As always, flick me a reply if your plans change.",
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

      console.log(`${email} – User prompt:`, userPrompt);
      // 4️⃣ Call LLM
      if (!OPENAI_API_URL) {
        throw new Error("OPENAI_API_URL is not defined");
      }
      const llmResponse = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
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
      const llmJson = await llmResponse.json() as {
        choices?: { message?: { content?: string } }[];
      };
      // Get the LLM response or fall back to a generic message
      const advice = llmJson?.choices?.[0]?.message?.content?.trim() ??
        `<p>You’re doing great, ${
          name || "mate"
        }. Here are the latest numbers.</p>`;

      // Format advice text by wrapping each line in <p> tags
      const formattedAdvice = advice
        .split("\n")
        .filter((line: string) => line.trim() !== "") // Remove empty lines
        .map((line: string) => `<p>${line.trim()}</p>`)
        .join("\n\n");

      const html = `
${formattedAdvice}

<p>${randomSelect(reachOutVariations)}</p>

<p>${randomSelect(signOffVariations)}<br>
${randomSelect(nameVariations)}</p>

<p>---</p>

<p><a href="${REGGIE_URL}/training?name=${name}&email=${email}&token=${trainingPlanToken}">View training plan</a></p>
<p><a href="${REGGIE_URL}/preferences?name=${name}&email=${email}">Edit preferences</a></p>
`;

      // 6️⃣ Send via Resend
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          // Randomly select a subject variation (e.g. "Morning, mate. Reggie here")
          subject: randomSelect(subjectVariations),
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
