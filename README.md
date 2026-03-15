# SNAG

A clean, minimal workplace issue-reporting app built with Expo and Supabase.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your Supabase URL and anon key

# 3. Run the database schema
# Go to Supabase → SQL Editor → New Query, paste supabase/schema.sql and run it
# Then create a public storage bucket named: issue-photos

# 4. Start the app
npx expo start
```

See `CLAUDE.md` for the full developer guide, including how to connect Claude Code and Supabase MCP.
