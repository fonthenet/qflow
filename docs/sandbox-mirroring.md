# Sandbox Mirroring Rule

Qflo sandbox is the pre-launch mirror of the real product.

## Rule

Every business-facing and customer-facing runtime surface must have a sandbox equivalent:

- booking
- kiosk
- desk
- queue tracking
- display

## Standard

- Prefer the real production component in sandbox mode over a separate preview-only implementation.
- Sandbox may replace live writes, alerts, and realtime subscriptions with safe local behavior.
- Sandbox should keep the same layout, wording, structure, and core actions whenever possible.

## Why

- Businesses should be able to test the real experience before launch.
- Templates should feel trustworthy before confirmation.
- Feature changes should not ship only to live mode and leave sandbox behind.

## Delivery rule

When a new business or customer workflow is added to Qflo:

1. Add or update the live/runtime surface.
2. Add or update the sandbox equivalent in the same change.
3. Keep the sandbox route discoverable from setup and the sandbox hub.

