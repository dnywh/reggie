# Email to Supabase Worker

A Cloudflare Email Worker that parses inbound emails and forwards content to a Supabase Edge Function.

## Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Configure environment**:

   Create `.env` for local development:

   ```bash
   SUPABASE_ANON_KEY=your-supabase-anon-key-here
   ```

   For production, use Wrangler secrets:

   ```bash
   wrangler secret put SUPABASE_ANON_KEY
   ```

3. **Update wrangler.jsonc**:
   ```json
   {
   	"vars": {
   		"SUPABASE_WEBHOOK_URL": "https://your-project.supabase.co/functions/v1/inbound"
   	}
   }
   ```

## Usage

```bash
# Test
npm test

# Local development
npm run dev

# Deploy
npm run deploy
```

## Payload Format

The worker sends this JSON to your Supabase Edge Function:

```json
{
	"from": "sender@example.com",
	"subject": "Email Subject",
	"body": "Email content",
	"timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Supabase Function Example

```typescript
// supabase/functions/inbound/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
	const { from, subject, body, timestamp } = await req.json();

	// Process email data
	console.log(`Email from ${from}: ${subject}`);

	return new Response(JSON.stringify({ success: true }), {
		headers: { 'Content-Type': 'application/json' },
	});
});
```

## Troubleshooting

- **"Could not resolve postal-mime"**: Run `npm install postal-mime`
- **"Handler does not export a fetch() function"**: Normal for Email Workers during local dev
- **Supabase webhook failures**: Check your Edge Function is deployed and accessible
