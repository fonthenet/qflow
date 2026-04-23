# United States — CCPA/CPRA, Colorado CPA, Virginia VCDPA, and State Patchwork

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.
> US privacy law is highly fragmented; this summary covers only the main frameworks.
> A comprehensive US privacy assessment requires counsel familiar with applicable state laws.

## Overview

The US has no single federal data protection law equivalent to GDPR. Instead, a patchwork of state privacy laws applies. As of April 2026, over 20 states have enacted comprehensive consumer privacy laws. Qflo's primary US exposure is through the California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA), given California's economic significance and regulatory leadership. The Colorado Privacy Act (CPA) and Virginia Consumer Data Protection Act (VCDPA) are also covered as representative of the state patchwork.

## California — CCPA/CPRA

**Scope:** Applies to for-profit businesses that: (a) have gross annual revenue exceeding USD 25M; or (b) annually buy, sell, or share personal data of 100,000+ consumers/households; or (c) derive 50%+ of annual revenue from selling or sharing personal data. For early-stage Qflo, threshold (a) is the most likely trigger as it scales. Monitor thresholds.

**Consumer rights (Cal. Civ. Code § 1798.100 et seq.):**
- Right to know (access)
- Right to delete
- Right to correct
- Right to opt-out of sale or sharing of personal information
- Right to limit use of sensitive personal information
- Right to non-discrimination for exercising rights

**Do Not Sell / Do Not Share:** If Qflo or its tenants "sell" or "share" (including for cross-context behavioral advertising) personal information of California consumers, a "Do Not Sell or Share My Personal Information" link is required on the homepage and in the privacy policy. Qflo does not sell data — confirm this position covers sharing with Meta for targeted advertising purposes.

**Sensitive personal information:** Health, biometric, financial, precise geolocation, racial/ethnic origin, religious beliefs, sexual orientation, and immigration status. Consumers have the right to limit processing of sensitive personal information.

**Privacy notice:** Must inform California consumers of categories of personal information collected, purposes, categories of third parties shared with, and consumer rights.

**Opt-out mechanism:** Must be honored within 15 business days.

**Response deadlines:** Respond to consumer requests within 45 days (extendable by 45 days with notice).

**Enforcement:** California Privacy Protection Agency (CPPA) and CA Attorney General. Fines up to USD 7,500 per intentional violation; private right of action for data breaches.

## Colorado — Colorado Privacy Act (CPA)

**Scope:** Applies to controllers that during a calendar year: (a) control or process data of 100,000+ Colorado consumers; or (b) control or process data of 25,000+ Colorado consumers and derive revenue from selling personal data.

**Rights:** Access, correction, deletion, data portability, opt-out of (i) targeted advertising, (ii) sale of personal data, (iii) profiling in furtherance of solely automated decisions with legal/significant effects.

**Universal opt-out:** Colorado (and many other states) requires honoring universal opt-out signals (e.g. Global Privacy Control).

**Response deadline:** 45 days (extendable to 90 days).

**Enforcement:** Colorado AG. No private right of action.

## Virginia — Consumer Data Protection Act (VCDPA)

**Scope:** Controllers that during a calendar year process data of 100,000+ Virginia consumers, or 25,000+ Virginia consumers and derive 50%+ of revenue from selling data.

**Rights:** Access, correction, deletion, portability, opt-out of targeted advertising/sale/profiling.

**Response deadline:** 45 days (extendable by 45 days).

**Enforcement:** Virginia AG. No private right of action.

## State Patchwork Note

As of April 2026, states with enacted comprehensive privacy laws include: California, Colorado, Virginia, Connecticut, Utah, Iowa, Indiana, Tennessee, Montana, Texas, Oregon, Florida, Delaware, New Hampshire, New Jersey, Kentucky, Nebraska, Minnesota, Maryland, Rhode Island, and others. The substantive requirements are broadly similar with variations in thresholds, sensitive data categories, and opt-out rights.

## Qflo-Specific Actions

- Confirm Qflo does not "sell" or "share" (for advertising) personal data — document this position.
- Add "Do Not Sell or Share" disclosure to privacy policy (even if not selling, a clear statement that Qflo does not sell data satisfies the disclosure obligation).
- Data subject request intake: `privacy@qflo.app` must be monitored with 45-day SLA for US consumers.
- If Vercel Analytics / PostHog share data for advertising purposes, that constitutes "sharing" under CCPA — gate behind marketing consent.
- Honor Global Privacy Control (GPC) signals when detected — Colorado and other states require this.
- Sub-processor contracts with Meta and Vercel should include CCPA-required service provider terms.
- Monitor additional state laws as they come into effect — implement a consistent baseline that satisfies most state requirements.

## References

- California Consumer Privacy Act (Cal. Civ. Code §§ 1798.100-1798.199.100), as amended by CPRA (Prop 24, 2020)
- California Privacy Protection Agency: cppa.ca.gov
- Colorado Privacy Act (C.R.S. §§ 6-1-1301 to 6-1-1313)
- Virginia Consumer Data Protection Act (Va. Code §§ 59.1-575 to 59.1-585)
- IAPP State Privacy Law Tracker: iapp.org
