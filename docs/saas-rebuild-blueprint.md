# QueueFlow SaaS Rebuild Blueprint

## Reset Decision

We should reset the product direction from source control, not from a raw Vercel deployment ID.

- `3Y89YyyohGP6pxEPzSuMpGSuEvS5` is a Vercel deployment/cache reference, not the right foundation for product work.
- The rebuild branch is based on commit `3760a30`.
- The right move is to preserve working backend and data flows, then rebuild the product surfaces from the ground up.

## What We Keep

The repo already contains useful building blocks that should survive the reset:

- authentication routes
- onboarding route scaffolding
- industry terminology templates
- queue and ticket actions
- platform admin routes
- billing, webhooks, and API key settings
- public queue and kiosk routes
- iOS and Android notification plumbing

These are implementation assets. The product framing and UX still need a ground-up rethink.

## QueueFlow Positioning

QueueFlow should not be "just a queue tool."

QueueFlow should be:

- customer flow software for service businesses
- usable for walk-ins, bookings, reservations, check-ins, and service handoff
- configurable by business category without feeling custom-built every time
- operational for staff, not just attractive for visitors

Core message:

> Manage arrivals, waiting, reservations, service handoff, and customer updates in one system.

## Product Pillars

### 1. Universal Intake

Every business needs one or more of these:

- QR scan to join
- shared link join
- staff-created visit
- appointment check-in
- reservation arrival
- kiosk intake

### 2. Flexible Service Flow

Each visit should move through a universal lifecycle:

- created
- waiting
- called
- serving
- completed
- cancelled
- no show
- transferred

### 3. Category-Aware Workspace

Every workspace should share the same shell, but adapt by category.

Shared areas:

- command center
- services and departments
- staff and stations
- customers
- bookings and reservations
- displays and kiosk
- analytics
- settings

### 4. Customer Journey That Feels Modern

Customer-facing flows should be:

- mobile first
- app-install free
- calm and readable
- brandable per business
- clear about next step and timing

### 5. Platform Control for the Owner

You need a super admin platform, not just org dashboards.

Platform admin must control:

- organizations
- plans and billing state
- staff and access anomalies
- active traffic and queue health
- branding and landing templates
- support tools
- feature flags
- audit history

## Rebuilt Information Architecture

### Marketing Site

- homepage
- solutions by category
- how it works
- pricing
- contact/demo
- legal pages

### Auth and Signup

- sign up
- sign in
- passwordless or email auth
- invite acceptance

### Onboarding

- business basics
- operating model
- arrival modes
- visitor experience
- billing and launch

### Business Dashboard

- command center
- calendar / bookings / reservations
- customers
- service setup
- staff and permissions
- displays and kiosk
- analytics
- integrations and settings

### Platform Admin

- platform overview
- organizations
- subscriptions and revenue
- active incidents
- feature flags
- website templates
- admin users

## Immediate Next Build Targets

1. Rebuild marketing homepage around the new product definition.
2. Rebuild auth/signup and onboarding so category drives the setup.
3. Rebuild the business dashboard shell and command center around a universal operations model.
4. Rebuild platform admin into a real owner console.
5. Reconnect customer-facing queue, booking, and reservation flows to the new structure.
