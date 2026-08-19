# SlotFlow — Multi-Tenant Appointment & Booking Platform

A booking platform where any service business (clinic, salon, tutor, coach, studio)
defines its availability rules and takes online appointments with deposit payments.

> **Status:** scaffolding — structure and boundaries only, no application code yet.

## Repository layout

This is a two-part monorepo — the backend and frontend are fully independent
deployables that share nothing but the HTTP contract documented by OpenAPI.

```
Appointment_booking/
├── backend/          Spring Boot 3 / Java 21 REST API      → deploys to Railway/Render
├── frontend/         React 18 + TypeScript + Vite SPA      → deploys to Vercel
├── docs/             UML diagrams, spec, architecture notes
└── docker-compose.yml (to come) — api, web, postgres, mailhog
```

| | Backend | Frontend |
|---|---|---|
| Language | Java 21 | TypeScript |
| Build | Maven | Vite / npm |
| Runs on | `:8080` | `:5173` (dev) |
| Owns | domain logic, persistence, auth, payments, email | rendering, routing, client state |
| Contract | publishes OpenAPI at `/swagger-ui.html` | consumes it via typed Axios client |

**Why they are separate:** the availability engine, tenant isolation and the
double-booking constraint are backend concerns that must hold regardless of client.
Keeping the SPA to a pure consumer of a documented REST API means the API can be
tested, versioned and deployed on its own — and it makes the boundary obvious to
anyone reading the repo.

## Documentation

Design docs — the project brief and the UML use case and class diagrams — are kept
locally under `docs/` and are not committed yet. The diagrams will be added here
once reviewed; the architecture diagram belongs in this README above the fold.
