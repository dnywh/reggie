import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Resend } from "npm:resend";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const FROM_EMAIL = `Reggie <${Deno.env.get("REGGIE_EMAIL")}>`;

Deno.serve(async () => {
  const to = ""; // Falsy if empty string

  try {
    const subject = "";
    const html = `
<p>Text here.</p>

<p>Reggie</p>
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
