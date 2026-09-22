# Sustainability Digital Twin

A browser-based 3D campus sustainability dashboard powered by a lightweight Node.js proxy for Gemini AI insights. It simulates real-time resource usage across five campus buildings, lets you inject problems, and generates AI recommendations based only on data collected up to the point the simulation is paused or stopped.

## Tech Stack

- HTML5, CSS3, vanilla JavaScript (ES modules)
- Three.js (loaded via CDN import map)
- Firebase Authentication (email/password, CDN import map)
- Node.js built-in `http` + `fetch` backend
- Google Gemini API via `gemini-3.5-flash-lite` (override with `GEMINI_MODEL` env var)
- No build step required

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

1. Configure Firebase in `js/firebase-config.js` (see Firebase Setup below).
2. Go to `/register.html` and create an account with email and password.
3. Log in with the same email and password.
4. Enter the 6-digit OTP sent to your email.
5. Paste your Gemini API key in the header.
6. Click **Start** in the Simulation panel, click any building for its dashboard, and use **Get AI Recommendation** after pausing/stopping.

## File Structure

```
├── index.html
├── login.html                     # Email/password login
├── register.html                  # Email/password sign up
├── otp.html                       # OTP verification
├── firebase-service-account.json  # Firebase Admin SDK credentials (keep secret)
├── css/
│   └── style.css
├── js/
│   ├── app.js                     # Three.js scene, UI wiring, dashboard
│   ├── auth.js                    # Firebase auth helpers
│   ├── login.js                   # Login page logic
│   ├── register.js                # Sign-up page logic
│   ├── otp.js                     # OTP page logic
│   ├── guard.js                   # Session guard for the dashboard
│   ├── firebase-config.js         # Public Firebase config (edit this)
│   ├── simulation.js              # SimulationEngine class
│   └── api.js                     # Frontend API client
├── server.js                      # Static server + Gemini proxy + OTP backend
├── package.json
└── README.md
```

## Firebase Setup

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Email/Password** authentication.
3. Copy your web app's public Firebase config (API key, app ID, etc.) into `js/firebase-config.js`.
4. Download a **service account** JSON from Firebase Console → Project Settings → Service accounts and save it as `firebase-service-account.json` in the project root.

The public Firebase config is safe to include in the frontend. The backend uses the **service account key** with the Firebase Admin SDK to verify ID tokens securely. Do not commit `firebase-service-account.json` to public repositories.

## Authentication Flow

1. **Sign-up page** (`/register.html`) — Creates a Firebase Authentication email/password account.
2. **Login page** (`/login.html`) — Firebase Authentication verifies email/password.
3. **OTP generation** — The backend verifies the Firebase ID token with the Firebase Admin SDK, generates a secure 6-digit code, stores a hash with a 5-minute expiry, and emails it via Nodemailer.
4. **OTP page** (`/otp.html`) — The user enters the 6-digit code. The backend verifies the hash and expiry, then sets an `HttpOnly` session cookie.
5. **Dashboard** (`/index.html`) — Protected by the session cookie. Unauthenticated requests are redirected to `/login.html`.

## Features

### 3D Campus
- Dark-themed scene with ground plane, grid, shadows, and orbit controls.
- Five colored, labeled, clickable academic buildings: Administration, Classrooms, Labs, Cafeteria, Hostels.
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

| Variable                  | Default                                   | Description                              |
|---------------------------|-------------------------------------------|------------------------------------------|
| `PORT`                    | `3000`                                    | Server port                              |
| `GEMINI_MODEL`            | `gemini-3.5-flash-lite`                   | Gemini model name                        |
| `SESSION_SECRET`          | random (sessions reset on restart)        | Secret for signing session cookies       |
| `SMTP_HOST`               | —                                         | SMTP host for sending OTP emails         |
| `SMTP_PORT`               | `587`                                     | SMTP port                                |
| `SMTP_USER`               | —                                         | SMTP username                            |
| `SMTP_PASS`               | —                                         | SMTP password                            |
| `SMTP_FROM`               | `SMTP_USER`                               | From address for OTP emails              |
| `SMTP_SECURE`             | `false`                                   | Use TLS (`true`/`false`)                 |
| `LOG_OTP`                 | `true`                                    | Print generated OTP in server console    |

If no SMTP variables are set, the server automatically creates a free [Ethereal Email](https://ethereal.email) test account and logs the preview URL in the console. For quick local testing, the generated OTP is also printed in the server console unless `LOG_OTP=false`.

## Notes

- The Gemini API key is stored only in `sessionStorage`; no `.env` file is required for it.
- AI recommendations are only available after pausing or stopping the simulation.
- The dashboard **Get AI Recommendation** button is disabled until a valid-looking key is entered and the simulation is paused/stopped.
