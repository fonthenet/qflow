# Kenya — Data Protection Act 2019 (Cap. 411C)

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.

## Overview

Kenya enacted the **Data Protection Act 2019 (DPA 2019)** (Act No. 24 of 2019), which came into force on 25 November 2019. Implementing regulations were issued in 2021: the Data Protection (General) Regulations 2021, Data Protection (Complaints Handling Procedure and Enforcement) Regulations 2021, and Data Protection (Registration of Data Controllers and Data Processors) Regulations 2021. The supervisory authority is the **Office of the Data Protection Commissioner (ODPC)**. Kenya's DPA is widely regarded as one of the more mature and well-implemented data protection frameworks in Sub-Saharan Africa, modelled substantially on the GDPR.

## Key Obligations

**Lawful basis:** Section 30 DPA 2019 mirrors GDPR Article 6 lawful bases: consent, contract, legal obligation, vital interests, public task, and legitimate interest. Consent must be freely given, specific, informed, and unambiguous (Section 2 definition).

**Data subject rights:** Kenya's DPA provides among the most comprehensive rights in African data protection:
- Right to information (Section 26)
- Right of access (Section 26)
- Right to rectification (Section 35)
- Right to erasure (Section 36)
- Right to restriction of processing (Section 37)
- Right to data portability (Section 38)
- Right to object (Section 39)
- Rights against automated decision-making (Section 40)

Response within 21 days (Registration Regulations prescribe response timelines). Complaints to the ODPC within 6 months of the act complained of.

**Registration:** Data controllers and data processors are required to register with the ODPC (Data Protection (Registration of Data Controllers and Data Processors) Regulations 2021). Qflo (as a data processor) should consider registration. Kenyan tenant organizations (as data controllers) must register. Registration fees apply on a tiered basis.

**Data localization / cross-border transfers:** Section 48 DPA 2019 restricts transfers to countries without adequate protection. The ODPC may publish adequacy decisions. In the absence of adequacy, transfers require contractual clauses (Sections 48(2)(d)), data subject consent, or other specified derogations. Kenya published the Data Protection (General) Regulations 2021 which address transfer safeguards — standard contractual clauses are recognized.

**Breach notification:** Within 72 hours of becoming aware of a personal data breach that is likely to result in risk to data subjects' rights (Regulation 22, Data Protection (General) Regulations 2021). Notify ODPC and (if high risk) affected data subjects.

**Data Protection Impact Assessments (DPIA):** Required for high-risk processing operations (Regulation 33, General Regulations).

**Penalties:** Up to KES 5 million or 1% of annual turnover (whichever is greater) for violations; up to KES 10 million or 2% for subsequent violations.

## Qflo-Specific Actions

- Qflo and Kenyan tenants should register with ODPC.
- Cross-border transfers to EU via Supabase: argue adequacy by analogy with GDPR; implement SCCs as conservative measure.
- Privacy notices in English and Kiswahili for Kenyan data subjects.
- Conduct DPIA for high-volume queue processing operations at scale.
- Health data for clinic vertical: sensitive category requiring explicit consent.
- Breach notification at 72 hours is aligned with Qflo's standard — maintain procedure.

## References

- Data Protection Act 2019 (Act No. 24 of 2019), Kenya Gazette Supplement No. 196 (Acts No. 24), 8 November 2019
- Data Protection (General) Regulations 2021 (Legal Notice No. 46 of 2021)
- Data Protection (Registration of Data Controllers and Data Processors) Regulations 2021
- ODPC: www.odpc.go.ke
