# Quantads - Production Tasks

## Phase 1: Critical (Week 1-2)
- [ ] Add PostgreSQL database with Prisma ORM (campaigns, bids, payments tables)
- [ ] Replace in-memory twin simulator with persistent campaign storage
- [ ] Implement real x402 payment settlement (Stripe + crypto wallet)
- [ ] Add authentication middleware (verify Quantmail SSO tokens)
- [ ] Add input validation (zod) for all API endpoints
- [ ] Create `.env.example` and Dockerfile

## Phase 2: Core Features (Week 3-4)
- [ ] Build campaign CRUD API (create, read, update, delete campaigns)
- [ ] Build real-time bidding auction system with WebSocket
- [ ] Add geofence event ingestion API (receive location events from mobile)
- [ ] Build analytics/reporting endpoints (impressions, clicks, conversions)
- [ ] Add A/B testing framework for ad variants
- [ ] Create `.github/workflows/ci.yml`

## Phase 3: Integration (Week 5-6)
- [ ] Connect to Quantmail for biometric-verified advertiser accounts
- [ ] Connect to Quanttube for video ad placement
- [ ] Connect to Quantchat for in-chat ad delivery
- [ ] Build QuantAds SDK for other apps to embed ads
- [ ] Add fraud detection (click fraud, bot traffic filtering)
