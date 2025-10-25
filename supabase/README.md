# Database schema management

This project uses a **Supabse dashboard-first approach** for database schema changes. This helps avoid migration history mismatches. We should move over to manual migration files once the application is a little more developed. But that should be a holistic, permanent move.

## Workflow

1. **Make schema changes** in Supabase Studio (production dashboard)
2. **Sync local with production**: `supabase db pull`
3. **Test locally** (if needed): `supabase db reset`
4. **Deploy functions**: `supabase functions deploy`

## Why

- **Simple**: no migration file management
- **Visual**: see changes in the dashboard
- **Immediate**: changes apply instantly
- **No conflicts**: avoids migration history mismatches

### Commands

```bash
# Sync local database with production
supabase db pull

# Reset local database to match migrations
supabase db reset

# Deploy functions to production
supabase functions deploy
```
