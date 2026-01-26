---
trigger: always_on
---

# 🧭 LaunchGrid — Architecture Constitution

## 1. Core Identity

LaunchGrid is an event-driven marketing orchestration platform.

It coordinates:
- Strategy
- Workflows
- Content generation
- Integrations
- Human approvals
- Analytics
- AI insights

AI is an enhancement layer, not the core engine.

---

## 2. Non-Negotiable Principles

1. API-first. UI is only a client.
2. Event-driven. Events are the system truth.
3. Strict service ownership. No shared databases.
4. Multi-tenant by design (Org → Projects → Users).
5. AI consumes APIs and events. Never databases.
6. Integrations are adapters, not business logic holders.
7. Workflows are declarative, not hardcoded.
8. Human-in-the-loop for social posting.
9. Observability and audit trail are first-class.
10. Prefer managed services over custom infra.

---

## 3. System Shape

Frontend
↓
API Gateway
↓
Core Services
↓
Event Bus
↓
Async Workers (AI, Workflows, Integrations)
↓
Datastores (per concern)


---

## 4. Core Services (Must be separate)

| Service | Owns |
|---|---|
| Auth & Tenant Service | Orgs, users, roles, isolation |
| Project & Blueprint Service | Projects, pillars, blueprints |
| Workflow Engine Service | Steps, triggers, dependencies |
| Task Orchestrator Service | Task lifecycle, roadmap |
| Content Service | Drafts, assets, channel formatting |
| Integration Service | API adapters (X, Discord, Ads, Email) |
| Event Service | Event storage and distribution |
| AI Insight Service | AI prompts, analysis, recommendations |
| Analytics Service | Metrics, CAC, LTV, performance |
| Audit Service | Decision logs, approvals |
| Notification Service | Emails, alerts |

No service accesses another service’s database.

---

## 5. Event-Driven Rule

Every important action emits an event:

- BlueprintCreated
- StepScheduled
- ContentDrafted
- HumanApprovedPost
- PostPublished
- MetricSynced
- AIInsightGenerated

Other services react to events.

---

## 6. Workflow Engine Rules

Workflows must be:

- Config-driven (JSON/state machine)
- Triggered by events
- Independent from AI and integrations
- Able to run without UI

---

## 7. AI Rules

AI is asynchronous and stateless.

Flow:



Event → Fetch context via APIs → Generate output → Store via API → Emit event


AI never blocks user actions.

---

## 8. Integration Rules

Integrations are adapters:

- Normalize external data
- Never leak external schemas inside core system
- Replaceable without breaking logic

---

## 9. Human-in-the-Loop Principle

For social platforms:

LaunchGrid prepares.
User approves and posts.

No ghost automation as a core dependency.

---

## 10. Data Separation

| Concern | Storage |
|---|---|
| Auth / Tenants | Managed auth DB |
| Projects / Blueprints | Relational DB |
| Events | Event store / queue |
| Workflow state | KV / Redis |
| Content / drafts | Document store |
| AI outputs | Document store |
| Logs / audit | Observability stack |

---

## 11. Security Principles

- Tenant isolation everywhere
- Encrypted secrets vault
- Least privilege between services
- Full audit of AI and user decisions
- Data export/delete possible

---

## 12. Scalability Model

Scale by:

- Adding workers
- Processing events in parallel
- Keeping services stateless

---

## 13. Definition of a Good Feature

A feature is good if:

- It belongs to one service
- It emits events
- It exposes APIs
- It does not require touching many services

---

## 14. LLM / Agent Rules

When generating code:

- Respect service boundaries
- Never bypass APIs
- Always define events
- Maintain tenant isolation
- Avoid coupling AI, workflows, and integrations

🧱 The Correct Target Architecture (evolved from yours)

You should evolve toward:

Next.js (UI)
     ↓
API Gateway
     ↓
Microservices (Node/Fastify or similar)
     ↓
Event Bus (Redis Streams / Kafka / NATS)
     ↓
Workers (AI, Workflow, Integrations)
     ↓
Postgres + Redis + Object Store
