# Egypt — Data Protection Law No. 151 of 2020

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.

## Overview

Egypt enacted its first dedicated data protection law, **Law No. 151 of 2020 on the Protection of Personal Data**, published in the Official Gazette on 15 July 2020. The law is implemented through **Executive Regulations issued by Prime Ministerial Decree No. 1022 of 2020**. The supervisory authority is the **Personal Data Protection Centre (PDPC)** operating under the Ministry of Communications and Information Technology (MCIT). Full enforcement has been phased in; controllers were given transitional periods to comply.

## Key Obligations

**Consent model:** Consent must be explicit, written (or equivalent electronic record), specific, and informed (Article 4). Processing may also be based on: contractual necessity, legal obligation, vital interests of the data subject, or legitimate interest (Article 5). For sensitive personal data (health, financial, religious, biometric), explicit consent is mandatory with no legitimate interest basis available.

**Data subject rights:** Data subjects have rights of access (Article 21), rectification (Article 22), objection (Article 23), and erasure (Article 24). The controller must respond within 30 days of receipt of a request. In case of refusal, data subjects may complain to the PDPC.

**Data localization:** Article 17 of the Executive Regulations addresses cross-border transfers. Transfer of personal data outside Egypt is permitted only where: (a) the destination country provides adequate protection (as determined by the PDPC); (b) the controller obtains PDPC approval; or (c) specific exceptions apply (contract performance, vital interests, legal claims). **No adequacy decisions have been published by the PDPC as of the knowledge cutoff.** This creates practical risk for cloud-hosted services storing Egyptian personal data. Recommend local Egyptian counsel review before onboarding Egyptian enterprise customers.

**Registration:** Controllers must register with the PDPC before processing (Article 14 of the Law). Registration requirements and fees are set by PDPC regulation.

**Breach notification:** Article 26 of the Law requires notification to the PDPC within 72 hours of becoming aware of a data breach. Notification to data subjects is required where the breach is likely to result in high risk.

**Penalties:** Significant criminal and civil penalties: fines up to EGP 5 million for certain offences; processing sensitive data without consent is a criminal offence.

## Qflo-Specific Actions

- Require Egyptian tenants to register with PDPC as data controllers.
- Cross-border transfer risk: advise Egyptian customers that their data processed via Supabase EU/US infrastructure may trigger Article 17 restrictions. Explore contractual safeguards and PDPC guidance.
- Privacy notices must be available in Arabic for Egyptian data subjects.
- Health data for clinic vertical: sensitive category requiring explicit written consent.
- Maintain evidence of consent for all Egyptian data subjects (timestamp, mechanism).

## References

- Law No. 151 of 2020 on the Protection of Personal Data (Official Gazette Issue 29 bis, 15 July 2020)
- Prime Ministerial Decree No. 1022 of 2020 (Executive Regulations)
- PDPC / MCIT: www.mcit.gov.eg
