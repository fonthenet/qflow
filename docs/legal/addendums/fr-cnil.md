# France — GDPR + CNIL Guidelines

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.

## Overview

France applies the **GDPR** directly as EU law, supplemented by the national implementation law **Loi n° 78-17 du 6 janvier 1978 relative à l'informatique, aux fichiers et aux libertés** (the "Loi Informatique et Libertés") as amended by Ordonnance n° 2018-1125 to align with GDPR. The supervisory authority is the **Commission Nationale de l'Informatique et des Libertés (CNIL)**. The CNIL is one of the most active EU data protection authorities and issues detailed practical guidance that sets de facto standards across the EU.

## Key Obligations

**Consent and legal basis:** GDPR Article 6 applies in full. The CNIL has specific guidance on the validity of consent, particularly for cookies: consent must be as easy to withdraw as to give, and "cookie walls" (blocking access unless cookies are accepted) are generally prohibited. The reject button must be as prominent as the accept button.

**Cookie compliance (critical for Qflo web):** The CNIL guidelines (Délibération n° 2020-091) require that: (a) analytics cookies require opt-in consent; (b) the consent interface must present accept and reject options equally prominently; (c) consent records must be stored and demonstrable. The CNIL has actively enforced cookie rules with significant fines (e.g. Google €150M, Facebook €60M in January 2022).

**Data subject rights:** All GDPR rights apply. The CNIL provides model letters for data subject requests. Response deadline is one month (extendable to three months with notice). Complaints to the CNIL are common and must be taken seriously.

**DPO requirement:** If processing is at large scale, systematic, or involves special categories of data, a Data Protection Officer must be appointed (Article 37 GDPR) and registered with the CNIL.

**Breach notification:** 72 hours to CNIL (Article 33 GDPR). If high risk to individuals, notification to data subjects without undue delay (Article 34).

**Cross-border transfers:** France is in the EEA so GDPR adequacy rules apply. Transfers outside the EEA require SCCs, adequacy decision, or BCRs. French supervisory coordination with other EEA authorities through the EDPB one-stop-shop mechanism.

**Special categories:** Health data processed by clinic verticals is a special category requiring explicit consent (Article 9 GDPR). CNIL has specific guidelines on health data; sector-specific rules under the Code de la santé publique may also apply.

## Qflo-Specific Actions

- Cookie banner must have a reject-all button that is equally prominent to accept-all (CNIL-compliant).
- Analytics (Vercel Analytics) must be opt-in for French visitors; gate behind analytics consent.
- DPO registration with CNIL required if processing at scale for French tenants.
- Health data for clinic vertical: verify compliance with CNIL health data guidelines before onboarding French healthcare tenants.
- Privacy policy must be in French for French-facing deployments (or at minimum bilingual).
- Maintain documented records of processing activities (Article 30 GDPR).

## References

- Loi n° 78-17 du 6 janvier 1978 (as amended)
- Délibération CNIL n° 2020-091 du 17 septembre 2020 (cookies)
- EDPB Guidelines 05/2020 on consent
- CNIL: www.cnil.fr
