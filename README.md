# Sustainability Digital Twin

A browser-based 3D campus sustainability dashboard powered by a lightweight Node.js proxy for Gemini AI insights. It simulates real-time resource usage across five campus buildings, lets you inject problems, and generates AI recommendations based only on data collected up to the point the simulation is paused or stopped.

## Tech Stack

- HTML5, CSS3, vanilla JavaScript (ES modules)
- Three.js (loaded via CDN import map)
- Node.js built-in `http` + `fetch` backend
- Google Gemini API via `gemini-3.5-flash-lite` (override with `GEMINI_MODEL` env var)
- No build step required

## Quick Start

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

1. Paste your Gemini API key in the header.
2. Click **Start** in the Simulation panel.
3. Click any building to open its dashboard.
4. Inject problems, pause/stop the simulation, and click **Get AI Recommendation**.
5. Use **Resolve Active Issues** to resolve problems based on the AI recommendation text.

## File Structure

```
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js          # Three.js scene, UI wiring, dashboard
│   ├── simulation.js   # SimulationEngine class
│   └── api.js          # Frontend API client
├── server.js           # Static server + Gemini proxy
├── package.json
└── README.md
```

## Features

### 3D Campus
- Dark-themed scene with ground plane, grid, shadows, and orbit controls.
- Five colored, labeled, clickable buildings: Administration, Classrooms, Labs, Cafeteria, Hostels.
- Hover highlights a building and shows a tooltip.
- Buildings glow red (critical) or yellow (warning) when active problems exist.
- Reset View button.

### Simulation Engine
- Starts / pauses / resumes / stops simulated time beginning at 08:00.
- Adjustable speed: 1x – 10x.
- Realistic diurnal patterns per building with peak hours and random noise.
- Records energy history every simulated 10 minutes.
- Injectable problems: HVAC Failure, Water Leak, Power Surge, Occupancy Spike, Equipment Malfunction, Lighting Failure.
- Problems apply metric multipliers, have configurable duration, and auto-expire.
- Emits events for start, pause, resume, stop, injection, resolution, and threshold alerts.

### Dashboard
- Per-building live metrics: Energy (kWh), Water (L), Occupancy (%), CO₂ (kg).
- Metric status colors: green (normal), yellow (warning), red (critical).
- Baseline comparison badges: red spike, blue drop, gray within baseline.
- Live canvas energy trend chart.
- AI insight / recommendation area.
- Resolve Active Issues button that matches the AI recommendation text to active problems.

### Gemini AI Backend
- `POST /api/insights` accepts the API key from the request body.
- Builds a concise prompt from paused/stopped metrics, deltas, active problems, and simulation time.
- In-memory response cache with 5-minute TTL.
- Generation config: `temperature: 0.4`, `maxOutputTokens: 400`.

## Environment Variables

| Variable       | Default                 | Description                  |
|----------------|-------------------------|------------------------------|
| `PORT`         | `3000`                  | Server port                  |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model name            |

## Notes

- The Gemini API key is stored only in `sessionStorage`; no `.env` file is required.
- AI recommendations are only available after pausing or stopping the simulation.
- The dashboard **Get AI Recommendation** button is disabled until a valid-looking key is entered and the simulation is paused/stopped.
