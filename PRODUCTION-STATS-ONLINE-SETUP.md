# Production Stats – online saving (Supabase)

So that **all PCs at work share the same data**, production logs and timers can be stored online using Supabase (free tier).

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → choose org, name, password, region → Create.
3. Wait for the project to be ready.

## 2. Create the table

In the Supabase dashboard: **SQL Editor** → **New query**.

**Copy only the SQL** (no markdown): open the file `supabase-production-data.sql` in this project and paste its contents into the Supabase SQL Editor. Or copy the block below — **do not include any line that says \`\`\`sql or \`\`\`**.

    create table production_data (
      key text primary key,
      value jsonb
    );

    alter table production_data enable row level security;

    create policy "Allow anon read and write"
      on production_data for all
      to anon
      using (true)
      with check (true);

Click **Run**.

## 3. Get your project URL and anon key

In the dashboard: **Project Settings** (gear) → **API**:

- **Project URL** (e.g. `https://xxxxx.supabase.co`)
- **anon public** key (under "Project API keys")

## 4. Configure the app

Before the app loads, set these (e.g. in your HTML or a small script that runs first):

```html
<script>
  window.CRISTAL_SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
  window.CRISTAL_SUPABASE_ANON_KEY = 'your-anon-key-here';
</script>
```

Replace with your real URL and anon key. This script must run **before** the main `index.html` script that uses production stats.

**Ways to do it:**

- **Option A:** In `index.html`, add the script block above right after `<head>` or before the closing `</body>`, so it runs before the rest of the page.
- **Option B:** If you serve the app from a small wrapper page, put this script there and then load the app (iframe or link).

## 5. Behaviour

- **When URL + key are set:** Opening the **Production Stats** tab loads logs and timers from Supabase into the app. Every save (new log, start/stop timer) is written to both the browser and Supabase.
- **When not set:** The app keeps using only the browser (localStorage); nothing is sent online.
- **Multiple PCs:** Each PC that has the same URL and key configured will read and write the same Supabase data, so everyone sees the same logs and totals.

## Security note

The **anon** key is meant for client-side use and is visible in the page. The RLS policy above allows any client with that key to read/write `production_data`. For a closed team that’s often acceptable. To lock it down later, you can restrict RLS by user or add a custom auth check.
