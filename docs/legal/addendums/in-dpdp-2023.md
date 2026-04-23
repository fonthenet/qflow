# India — Digital Personal Data Protection Act 2023 (DPDP Act)

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.

## Overview

India enacted the **Digital Personal Data Protection Act 2023 (DPDP Act)** (No. 22 of 2023), which received Presidential assent on 11 August 2023. The Act repeals the previous IT Act Section 43A framework. The supervisory body is the **Data Protection Board of India (DPBI)**, constituted under the Act, though as of early 2025 the implementing rules (Rules under Section 40) were still in the consultation and finalization stage. The DPDP Act applies to processing of digital personal data within India, and to processing outside India if the data relates to offering goods or services to persons in India.

## Key Obligations

**Consent model (Consent as default):** Processing of personal data requires **consent** (Section 6) or falls within "legitimate uses" (Section 7). Legitimate uses include: (a) the data principal voluntarily provided data and consent was reasonably expected; (b) state and its instrumentalities processing for subsidies/licences; (c) employment purposes; (d) medical emergencies. For Qflo's queue management context, consent is the appropriate basis. Consent notices must be in English or any language listed in the Eighth Schedule of the Constitution of India, clear and standalone — not buried in ToS.

**Data principal rights:** Under Section 11-14 DPDP Act, data principals have rights to:
- Access summary of personal data being processed (Section 11)
- Correction, completion, updating, and erasure (Section 12)
- Grievance redressal (Section 13)
- Nominate another person to exercise rights in case of death or incapacity (Section 14)

Response deadline: The Rules are expected to specify timelines; expect 30 days as a working standard.

**Data localization:** Section 16 enables the Central Government to restrict transfer of personal data to certain countries/territories via notification. The **negative list** (restricted countries) has not been published as of the knowledge cutoff. Until the Rules and restrictions are notified, cross-border transfers are generally permissible — but this could change. Monitor closely.

**Data fiduciaries vs. data processors:** The DPDP Act uses "Data Fiduciary" (controller) and "Data Processor" terminology. Qflo acts as a Data Processor for its tenants who are Data Fiduciaries.

**Significant Data Fiduciaries (SDF):** If Qflo's Indian operations or a tenant's scale crosses thresholds set by the government, SDF status triggers additional obligations (DPO appointment, data audits, DPIA). Thresholds not yet published.

**Breach notification:** Section 8(6) requires the Data Fiduciary to notify the DPBI and affected data principals of a personal data breach, in prescribed form and manner. Notify promptly upon becoming aware (timelines to be prescribed in Rules).

**Children:** Section 9 prohibits processing personal data of children (under 18) without verifiable parental consent, and prohibits tracking or behavioral monitoring of children. No targeted advertising to children.

**Penalties:** Up to INR 250 crore (approximately USD 30M) for failure to implement adequate security safeguards; up to INR 200 crore for failure to notify breaches; up to INR 50 crore for other violations.

## Qflo-Specific Actions

- Implement a consent receipt mechanism for Indian data principals joining queues.
- Data erasure flow (right to erasure) must be operable for Indian customers before enforcement begins.
- Monitor MeitY Rules publication — they will specify timelines, formats, and the SDF threshold.
- Cross-border transfer: currently permissible but build the capability to restrict specific countries once the negative list is published.
- Children: ensure kiosk and web join flows do not collect data from under-18s without parental consent (age verification may be required by rules).
- Privacy notice in Hindi and relevant regional language(s) in addition to English.

## References

- Digital Personal Data Protection Act 2023 (No. 22 of 2023), Gazette of India Extraordinary, 11 August 2023
- Ministry of Electronics and Information Technology (MeitY): www.meity.gov.in
- Draft DPDP Rules 2025 (consultation draft — not final as of knowledge cutoff)
