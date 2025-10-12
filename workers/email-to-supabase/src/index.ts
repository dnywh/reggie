/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import PostalMime from "postal-mime";

// export default {
// 	async fetch(request, env, ctx): Promise<Response> {
// 		return new Response('Hello World!');
// 	},
// } satisfies ExportedHandler<Env>;

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Temporary handler for local testing
		// This allows npm run dev to work
		return new Response(
			"This is an *email* worker. Use the email handler in production",
			{
				headers: { "Content-Type": "text/plain" },
			},
		);
	},

	async email(message, env, ctx): Promise<void> {
		// 1️⃣ Parse the raw email
		const email = await PostalMime.parse(message.raw, {
			attachmentEncoding: "base64",
		});

		const from = email.from?.address || message.from;
		const subject = email.subject || "";
		const body = email.text || email.html || "";

		console.log({
			Subject: subject,
			From: from,
			Body: body,
		});

		// 2️⃣ Build payload for Supabase
		const payload = {
			from,
			subject,
			body,
			timestamp: new Date().toISOString(),
		};

		// 3️⃣ Forward the payload to Supabase Edge Function
		try {
			const res = await fetch(env.SUPABASE_WEBHOOK_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
					"User-Agent": "Cloudflare-Email-Worker/1.0",
				},
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				const errorText = await res.text();
				console.error(
					`Supabase webhook failed with status ${res.status}:`,
					errorText,
				);
				throw new Error(`Webhook failed: ${res.status} ${errorText}`);
			}

			console.log("Email successfully forwarded to Supabase");
		} catch (err) {
			console.error("Error posting to Supabase:", err);
			// Re-throw to ensure the error is logged properly
			throw err;
		}
	},
} satisfies ExportedHandler<Env>;
