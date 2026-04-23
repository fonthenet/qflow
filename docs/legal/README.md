# docs/legal — Legal Document Registry

LAWYER REVIEW REQUIRED before any document in this directory is signed with or
presented to a customer, regulator, or third party.

## Placeholder Registry

The following placeholders appear across legal documents and must be resolved
before any document is used in a live context.

| Placeholder | Status | Owner | Notes |
|---|---|---|---|
| `{{COMPANY_ADDRESS}}` | PENDING | Legal / Founder | Registered office address of Qflo SAS. Fill in `data-processing-agreement.md` section 8 and all addendums that reference a mailing address. Requires a registered legal entity with a physical address. |
| `[EFFECTIVE DATE]` in DPA | Filled per signing | Ops | Set to the date the DPA is countersigned by the customer. |
| `[CUSTOMER NAME]` / `[CUSTOMER COUNTRY]` | Filled per signing | Ops | Specific to each customer engagement. |
| `[CUSTOMER COUNTRY / EU member state]` in DPA §9 | Filled per signing | Legal | Governing law clause — must be agreed with customer. |

## Assumed Legal Entity

Documents currently assume **Qflo SAS** as the Processor entity.

- If the actual entity differs (e.g. Qflo Ltd, Qflo SARL, or a holding company), every reference
  to "Qflo SAS" in these documents must be updated before use.
- LAWYER REVIEW REQUIRED to confirm the correct contracting entity per jurisdiction.

## DPO / Privacy Contact

**Email:** privacy@qflo.app
**Company:** Qflo SAS
**Postal:** `{{COMPANY_ADDRESS}}` — fill before use.

## Lawyer Review Packet

All open legal questions are consolidated in `LAWYER-REVIEW-PACKET.md`.  
Send this file to external counsel before any document is used with a customer.  
Questions are grouped by urgency: before first customer signature, before first EU/US/Algeria/Morocco/India customer, and ongoing.

20 open questions as of 2026-04-23 — none resolved yet.

## Document Index

| File | Description | Review Status |
|---|---|---|
| `LAWYER-REVIEW-PACKET.md` | All open questions for external counsel | SEND TO COUNSEL — 20 open items |
| `data-processing-agreement.md` | GDPR Art. 28 DPA template | Draft — lawyer review required (Q6) |
| `addendums/dz-loi-18-07.md` | Algeria Law 18-07 addendum | Draft — blocked on Q11, Q12, Q13 |
| `addendums/ma-loi-09-08.md` | Morocco Law 09-08 addendum | Draft — blocked on Q14, Q15 |
| `addendums/tn-loi-2004-63.md` | Tunisia Law 2004-63 addendum | Draft |
| `addendums/fr-cnil.md` | France CNIL / GDPR addendum | Draft |
| `addendums/eg-data-protection-law.md` | Egypt Data Protection Law | Draft |
| `addendums/ae-pdpl-2021.md` | UAE PDPL 2021 addendum | Draft |
| `addendums/sa-pdpl.md` | Saudi Arabia PDPL addendum | Draft |
| `addendums/in-dpdp-2023.md` | India DPDP Act 2023 addendum | Draft — blocked on Q16, Q17 |
| `addendums/sn-loi-2008-12.md` | Senegal Law 2008-12 addendum | Draft |
| `addendums/ci-loi-2013-450.md` | Ivory Coast Law 2013-450 addendum | Draft |
| `addendums/ng-ndpr.md` | Nigeria NDPR addendum | Draft |
| `addendums/ke-dpa-2019.md` | Kenya DPA 2019 addendum | Draft |
| `addendums/us-ccpa-colo.md` | US CCPA/CPRA + Colorado CPA addendum | Draft — blocked on Q9, Q10 |
