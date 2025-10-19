```


   ██                                 █
   █░█                 █  █ ██ ██   ██▓
    ███             ▓█ █ ██ █ █ █ █ █  ██
      ██▓█ █      ██ ██ █ ░ █ █  █  █  █ █
        ████ █ ███ █ █  ███ █    █ ██    ██
            ███████ ▓█    █ ██  █░██
                    ██ █        ███
                   ██  ████     ███
                    █             ███

```

# Reggie

A personal assistant system built with Supabase and Cloudflare Workers for email processing and automation.

## Components

- **Email Worker** (`workers/email-to-supabase/`): Processes incoming emails and forwards to Supabase
- **Supabase Functions** (`supabase/functions/`): Backend processing for inbound emails, morning reviews, replies, and Strava sync

## Tech Stack

- Supabase (PostgreSQL, Edge Functions)
- Cloudflare Email Workers
- PostalMime for email parsing
- TypeScript

## Quick Start

1. **Setup Supabase**:

   ```bash
   cd supabase
   supabase start
   supabase functions deploy
   ```

2. **Setup Email Worker**:

   ```bash
   cd workers/email-to-supabase
   npm install
   npm run deploy
   ```

3. **Configure Secrets**:
   ```bash
   wrangler secret put SUPABASE_ANON_KEY
   ```

## Development

```bash
# Email worker
cd workers/email-to-supabase
npm test
npm run dev

# Supabase functions
cd supabase
supabase functions serve
```

## Data Flow

Email → Cloudflare Worker → Supabase Edge Function → Database/Processing

## Documentation

- [Email Worker README](./workers/email-to-supabase/README.md)
