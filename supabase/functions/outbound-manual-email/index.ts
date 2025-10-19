import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
import { Resend } from "npm:resend";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;
const TEST_EMAIL = Deno.env.get("TEST_EMAIL");

Deno.serve(async () => {
  const recipient = ""; // Falsy if empty string
  const to = recipient ? recipient : TEST_EMAIL;

  try {
    const subject = "Hey there";
    const html = `
      <p>Hello there!</p>
      <p>Here is a list of things:</p>
      <ul>
        <li>Thing 1</li>
        <li>Thing 2</li>
        <li>Thing 3</li>
      </ul>

      <p>Thanks for testing!<br />
      Reggie</p>
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
