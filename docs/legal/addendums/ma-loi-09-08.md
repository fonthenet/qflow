# Morocco — Loi 09-08 relative à la Protection des Personnes Physiques à l'égard du Traitement des Données à Caractère Personnel

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.

## Overview

Morocco's data protection framework is governed by **Loi n° 09-08 du 18 février 2009** and its implementing decrees. The supervisory authority is the **Commission Nationale de Contrôle de la Protection des Données à Caractère Personnel (CNDP)**. Morocco was granted **EU adequacy status** by the European Commission (Decision 2011/61/EU — though practitioners should verify current status), which simplifies data transfers from the EU to Morocco. Morocco is also a signatory to Convention 108 of the Council of Europe.

## Key Obligations

**Consent model:** Article 4 requires consent to be freely given, specific, and informed. Processing may also be based on legal obligation, contract performance, vital interests, or legitimate interest (Article 4(2)). For direct marketing or sensitive data, consent must be explicit.

**Data subject rights:** Data subjects have rights of access (Article 7), rectification (Article 8), objection (Article 10), and erasure (Article 9). Controllers must respond within 60 days for access requests (shorter timelines are good practice).

**Data localization / cross-border transfers:** Article 43 prohibits transfer of personal data to countries that do not ensure adequate protection. However, Morocco itself has an EU adequacy decision, making Morocco-EU and EU-Morocco flows relatively straightforward. Transfers from Morocco to the US (via Supabase/Vercel infrastructure) require appropriate safeguards — CNDP authorization or contractual guarantees.

**Registration:** Controllers must declare their processing activities to the CNDP (Article 15) before commencing processing. Certain categories of processing require prior CNDP authorization (Article 16). Qflo tenants in Morocco should register their queue management operations as controllers.

**Breach notification:** Loi 09-08 does not prescribe specific breach notification timelines. Apply conservative 72-hour internal standard and notify CNDP and affected individuals promptly.

## Qflo-Specific Actions

- Notify Moroccan tenants of CNDP declaration obligation before they go live.
- Privacy notices must be available in French and/or Arabic (Darija not required in legal texts but French is the standard).
- Verify CNDP adequacy status for Supabase EU region data flows.
- Cross-border transfer to US infrastructure requires CNDP authorization or SCCs.
- Include CNDP complaint right in privacy notices for Moroccan data subjects.

## References

- Loi n° 09-08 (Bulletin Officiel n° 5714 du 18 safar 1430 / 5 février 2009)
- Décret n° 2-09-165 du 25 joumada I 1430 (21 mai 2009) — implementing decree
- CNDP: www.cndp.ma
