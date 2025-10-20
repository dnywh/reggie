import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Resend } from "npm:resend";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
const TEST_EMAIL = Deno.env.get("TEST_EMAIL");
const REGGIE_URL = Deno.env.get("REGGIE_URL");

Deno.serve(async () => {
  const recipient = ""; // Falsy if empty string
  const to = recipient ? recipient : TEST_EMAIL;

  const includePreferencesLink = true;

  try {
    const subject = "Hey there";
    const html = `
      Hello there!
      Here is a list of things:
      <ul>
        <li>Thing 1</li>
        <li>Thing 2</li>
        <li>Thing 3</li>
      </ul>

      Thanks for testing!
      Reggie

      ${
      includePreferencesLink
        ? `
      ---
      P.S. am I emailing too much? Too little? You can <a href="${REGGIE_URL}/preferences?email=${to}">edit your preferences</a> at any time.
      `
        : ""
    }
      `;

    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    console.log(
      `✅ Sent email to ${to}`,
    );
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err);
  }
  return new Response("OK");
});
