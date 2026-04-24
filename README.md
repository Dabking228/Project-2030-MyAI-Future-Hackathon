# 🚇 SYBAR_AI

**Where AI meets Malaysian public transport.**

SYBAR_AI is a transit planning platform that combines a mobile chat interface, a GTFS-powered optimization engine, and a Genkit/Firebase AI orchestration layer.

Ask in natural language, get optimized routes, compare alternatives, and view live vehicles plus carbon impact on an interactive map.

![Expo](https://img.shields.io/badge/Expo-54.0.33-000020?style=flat-square)
![React Native](https://img.shields.io/badge/React_Native-0.81.5-20232a?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-0.136.0-009688?style=flat-square)
![Genkit](https://img.shields.io/badge/Genkit-1.32.0-4285f4?style=flat-square)
![Firebase Functions](https://img.shields.io/badge/Firebase_Functions-v2-orange?style=flat-square)
![OR--Tools](https://img.shields.io/badge/OR--Tools-9.15-blue?style=flat-square)

---

## ✨ Features At a Glance

| Layer | What it does |
|------|---------------|
| **Frontend (Expo)** | Chat UI, location autofill, route cards, map visualization, carbon tab |
| **AI Agent (Genkit + Firebase Functions)** | Intent parsing, tool orchestration, response formatting |
| **Backend (FastAPI + NetworkX)** | GTFS ingestion, route optimization, TSP solving, realtime overlays |

**Core capabilities:**
- 💬 Natural-language route planning (`single_route`, `multi_destination`, `clarification_needed`)
- 🧠 AI tool-calling flow to backend APIs (not hardcoded route replies)
- 🚆 Objective-based optimization: `time`, `cost`, or `eco`
- 🗺️ Route results screen with stop markers, polylines, and draggable bottom sheet
- 🚌 Live GTFS-realtime vehicle overlay (feed-based)
- 🌿 Carbon summary vs private car baseline (CO2 saved + tree-day equivalent)
- 📍 Nearest-stop and stop-name search endpoints
- 🔁 Multi-destination planning via OR-Tools TSP solver

---

## SDGs Addressed

This solution supports the following UN Sustainable Development Goals (SDGs):

- **SDG 9: Industry, Innovation and Infrastructure**  
  Improves digital mobility infrastructure through AI-driven transit planning and routing intelligence.
- **SDG 11: Sustainable Cities and Communities**  
  Encourages public transport usage with better journey planning, multi-destination optimization, and smoother user experience.
- **SDG 13: Climate Action**  
  Reduces reliance on private vehicles, helping lower transport-related carbon emissions.

## Problem Statement

- Growing dependency on private vehicles increases carbon emissions and environmental impact.
- Multi-destination trip planning is often unavailable in public transport tools.
- Payment and mapping systems are fragmented, making it harder for users to track transit spending and transactions.

## Impact

- Aligns with Malaysia's 2030 carbon emission reduction direction.
- Supports higher public transport adoption by making transit planning more practical.
- Delivers a better navigation experience, especially for tourists and new riders.

---

### End-to-End Flow

1. User asks a transport question in the Expo app.
2. Frontend calls Firebase callable function `chat`.
3. `chatFlow` parses intent and calls the right tool (`optimizeRoute` or `optimizeTSPRoute`).
4. Tool hits FastAPI (`/api/v1/route` or `/api/v1/route/tsp`).
5. Backend computes route from GTFS graph (+ realtime delay overlay), returns structured result.
6. AI formatter turns result into chat text while preserving structured route data.
7. Frontend renders response and opens map/result screen when user taps **View Route**.

---

## 🧠 Backend Data + Optimization Model

- Loads **16 GTFS static feeds** from `api.data.gov.my` on startup.
- Builds a `networkx.MultiDiGraph`:
  - Nodes = transit stops
  - Transit edges = trip segments with time/fare/CO2 weights
  - Walk edges = inter-stop transfers within max 500m
- Fetches GTFS realtime vehicle feeds and infers trip delay overlays.
- Supports:
  - Single OD route optimization (`time`, `cost`, `eco`)
  - Alternatives (other objectives)
  - TSP visit order for 2-10 destinations via OR-Tools

Carbon model (configurable in `Backend/app/config.py`):
- Rail: `14 g/km`
- Bus: `68 g/km`
- Car baseline: `192 g/km`

---

## 🚀 Getting Started

## Prerequisites

- **Node.js 22** (required by Firebase Functions `engines.node`)
- **Python 3.11+** (3.13 works with this repo)
- **Firebase CLI**
- **Google Cloud CLI** (for Vertex/Genkit auth)
- **Expo tooling** (Android/iOS simulator or physical device)
- **Google Maps API key** (for mobile map rendering)

## 1) Clone

```bash
git clone <your-repo-url>
cd Project-2030-MyAI-Future-Hackathon
```

## 2) Start Backend (FastAPI)

```bash
cd Backend
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health check:
```bash
curl http://localhost:8000/health
```

Note: first startup downloads GTFS feeds and builds graph, so it can take a while.

## 3) Start AI Agent (Firebase Functions + Genkit)

Create `AI_Agent/.env` from `AI_Agent/.env.example` and set:
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION` (default `us-central1`)
- `GOOGLE_APPLICATION_CREDENTIALS`
- `FASTAPI_BASE_URL` (example: `http://localhost:8000/api/v1`)
- optional `RAG_CORPUS_NAME`

Install and run:
```bash
cd AI_Agent/functions
npm install
npm run build
```

For local Firebase callable testing:
```bash
cd ..
firebase emulators:start --only functions
```

For Genkit dev UI:
```bash
cd functions
npm run dev
```

## 4) Start Frontend (Expo)

Create `Frontend/.env` from `Frontend/.env.example` and set:
- Firebase web config (`EXPO_PUBLIC_FIREBASE_*`)
- `EXPO_PUBLIC_FASTAPI_URL` (example: `http://localhost:8000/api/v1`)
- `EXPO_PUBLIC_GOOGLE_MAPS_KEY`
- `EXPO_PUBLIC_USE_EMULATOR=true` for local callable function testing
- optional `EXPO_PUBLIC_EMULATOR_HOST`

Install and run:
```bash
cd Frontend
npm install
npm run start
```

Useful scripts:
```bash
npm run android
npm run ios
npm run web
```

---

## 🔌 API Surface (Backend)

Base: `http://localhost:8000/api/v1`

- `POST /route` - optimize single trip
- `POST /route/tsp` - optimize multi-destination trip order
- `GET /stops/nearest` - nearest stops by coordinates
- `GET /stops/search` - stop search by name
- `GET /graph/stats` - graph node/edge/feed stats
- `GET /realtime/vehicles` - live vehicle positions (optional `feed` query)

Example single-route request:

```json
{
  "origin": { "lat": 3.1344, "lon": 101.6862 },
  "destination": { "lat": 3.1579, "lon": 101.7116 },
  "optimize_for": "time",
  "return_alternatives": true
}
```

---

## 🧩 Tech Stack

- **Mobile:** Expo Router, React Native, TypeScript, `react-native-maps`
- **AI Orchestration:** Genkit, Vertex AI (`gemini-2.5-flash`), Firebase Functions v2
- **Backend:** FastAPI, Pydantic v2, NetworkX, OR-Tools, Pandas, NumPy
- **Transit Data:** GTFS static + GTFS realtime feeds from `api.data.gov.my`

---

## 📄 License

This project is developed for educational and hackathon purposes.
