# Factory Map – Digital Twin (React)

Interactive factory map with draggable areas, zoom/pan, and area details. Uses Supabase for persistence.

## Setup

1. **Install dependencies**
   ```bash
   cd factory-map && npm install
   ```

2. **Supabase**
   - Create the `factory_areas` table: run `supabase-factory-areas.sql` in the Supabase SQL Editor.
   - Copy `.env.example` to `.env` and set:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`

3. **Run**
   ```bash
   npm run dev
   ```
   Open the URL shown (e.g. http://localhost:5173).

## Controls

- **Scroll:** Zoom in/out  
- **Drag background:** Pan  
- **Drag an area:** Move it (saves to Supabase)  
- **Click an area:** Open details panel (status, load, update)

## Build

```bash
   npm run build
   ```
   Output in `dist/`. Deploy that folder to any static host.
