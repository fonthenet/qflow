# Algeria — Loi 18-07 sur la Protection des Données Personnelles

> LAWYER REVIEW REQUIRED before relying on this summary for customer commitments.
> This is a reference summary for Qflo tenant administrators, not legal advice.

## Overview

Algeria enacted **Loi n° 18-07 du 10 juin 2018 relative à la protection des personnes physiques dans le traitement des données à caractère personnel**. This is Algeria's primary personal data protection law, closely modelled on the EU Directive 95/46/EC framework (predating GDPR). The supervisory authority is the **Autorité Nationale de Protection des Données à Caractère Personnel (ANPDP)**, established by Articles 37–57 of the law, though the ANPDP has been slow to become fully operational as of 2025.

## Key Obligations

**Consent model:** Processing generally requires the data subject's free, specific, informed, and unambiguous consent (Article 7). Processing may also be based on legal obligation, contractual necessity, vital interests, or legitimate interest — mirroring the GDPR Article 6 structure. Consent must be obtained in the language the data subject understands; for Algerian customers this means Arabic or French.

**Data subject rights:** Data subjects have rights of access (Article 20), rectification (Article 21), erasure (Article 23), and objection (Article 25). Qflo tenants operating in Algeria must have a mechanism to receive and respond to these requests. Response timeline is 30 days.

**Data localization:** Article 32 and associated decrees impose restrictions on cross-border transfers of personal data outside Algeria. Transfers require either: (a) the destination country ensures adequate protection, or (b) express ANPDP authorization (via adequacy decision or binding contractual guarantees). **Practical implication for Qflo:** Algerian tenant data stored on Supabase eu-central-1 (EU region) may require ANPDP authorization for cross-border transfer. Tenants should obtain legal advice on whether the EU constitutes an "adequate" destination under Algerian rules — this has not been formally decided as of the knowledge cutoff. Until clarity exists, recommend local legal counsel review for DZ customers with sensitive data.

**Registration / notification:** Controllers were historically required to register processing activities with the ANPDP. Confirm current status of this requirement with local counsel as ANPDP operationalization continues.

**Breach notification:** The law does not specify a strict 72-hour breach notification period. Notify the ANPDP and data subjects without undue delay upon becoming aware of a breach — align with Qflo's standard 72-hour commitment to be conservative.

## Qflo-Specific Actions

- Privacy notices for Algerian visitors must be available in Arabic and French.
- Consent for WhatsApp notifications should be explicit and recorded.
- DPO contact must be disclosed in the privacy notice.
- Cross-border transfer clause to be reviewed by local Algerian counsel before customer sign-up.
- Track with ANPDP operationalization updates; registration obligation may activate.

## References

- Loi 18-07 du 10 juin 2018 (Journal Officiel n° 34 du 10 juin 2018)
- Décret exécutif n° 20-170 du 15 juin 2020 (ANPDP internal regulations)
