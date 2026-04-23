# Lawyer Review Packet — Qflo

**Prepared by:** Compliance Officer (AI agent — not a lawyer)  
**Date:** 2026-04-23  
**For:** External legal counsel  
**Instruction:** Every item below is a question for counsel. No item in this packet constitutes legal advice.

---

## Priority 1 — Before First Customer Signature

These items block any DPA or contract from being presented to any customer in any jurisdiction.

### Q1. Legal entity confirmation
**Context:** All DPA templates and addendums currently name "Qflo SAS" as the Processor. If the actual registered entity differs (e.g., Qflo SARL, Qflo Ltd, or a holding-company structure), every legal document must be updated before use.  
**Question for counsel:** Please confirm the correct legal entity name, registration number, and registered address.  
**Answer lands in:** `docs/legal/README.md` — Placeholder Registry (`{{COMPANY_ADDRESS}}`) and all addendum headers.

### Q2. `{{COMPANY_ADDRESS}}` — registered office
**Context:** Every document referencing a mailing address or registered office currently uses the placeholder `{{COMPANY_ADDRESS}}`.  
**Question for counsel:** What is the registered office address to be printed on contracts?  
**Answer lands in:** `docs/legal/data-processing-agreement.md` §8; all regional addendums.

### Q3. DPA §9 governing law default
**Context:** The DPA §9 governing law clause is filled per signing (customer's EU member state). We need to know whether we should propose a default jurisdiction (e.g., France) or leave it blank for negotiation.  
**Question for counsel:** Should we propose a default governing law, and if so, which jurisdiction?  
**Answer lands in:** `docs/legal/data-processing-agreement.md` §9.

### Q4. SCC execution mechanics
**Context:** The DPA references Standard Contractual Clauses (Module 2, Controller to Processor) for data transfers from EU customers to any non-EEA subprocessor. We need to know whether SCCs should be separately signed exhibits or incorporated by reference.  
**Question for counsel:** Should SCCs be (a) separately-signed appendix, (b) incorporated by reference into the DPA with a link to the EDPB-approved text, or (c) another mechanism?  
**Answer lands in:** `docs/legal/data-processing-agreement.md` §5 and SCC Annex.

### Q5. DPO appointment formality
**Context:** Privacy contact email privacy@qflo.app is documented. Whether a formal DPO appointment is legally required (GDPR Art. 37 threshold) depends on the scale of processing.  
**Question for counsel:** Is a formal DPO appointment required? If not, what language should we use for the "privacy contact" role to avoid inadvertently implying DPO status?  
**Answer lands in:** `docs/legal/README.md` and Privacy Policy.

---

## Priority 2 — Before First EU Customer

### Q6. Article 28 DPA review
**Context:** `docs/legal/data-processing-agreement.md` is a draft prepared without legal review.  
**Question for counsel:** Please review the full DPA for GDPR Art. 28 compliance, including sub-processor chain, audit rights, and deletion/return obligations.  
**Answer lands in:** `docs/legal/data-processing-agreement.md` (revised version).

### Q7. SCC Module 2 wording
**Context:** We intend to use EDPB-approved SCC Module 2 (Controller to Processor) for EU customer data flowing to Supabase (EU-hosted) and Meta Cloud API (US-hosted).  
**Question for counsel:** Is our current SCC attachment adequate? Does the Meta Cloud API transfer require a Transfer Impact Assessment (TIA)?  
**Answer lands in:** `docs/legal/data-processing-agreement.md` SCC Annex + `docs/compliance/evidence/` TIA file (to create).

### Q8. Transfer Impact Assessment template
**Context:** No TIA currently exists. Required before relying on SCCs for transfers to Meta (US) from EU controllers.  
**Question for counsel:** Please provide or approve a TIA template for the Meta Cloud API transfer.  
**Answer lands in:** `docs/legal/transfer-impact-assessments/meta-cloud-api.md` (to create).

---

## Priority 3 — Before First US Customer

### Q9. CCPA "Do Not Sell" adequacy
**Context:** The Qflo privacy page shows a "Do Not Sell or Share My Personal Information" link leading to an opt-out form. We do not believe we currently "sell" data as defined by CCPA, but we share data with Meta (advertising infrastructure).  
**Question for counsel:** Does our Meta Cloud API integration constitute "sharing" under CCPA's expanded definition? Is our current opt-out flow adequate?  
**Answer lands in:** `docs/compliance/global.md` CCPA row + Privacy Policy §6.

### Q10. ADA kiosk accessibility status
**Context:** Accessibility audit `docs/qa/a11y-audit-2026-04-23.md` shows GREEN across all severity levels as of 2026-04-23. The Qflo Station kiosk may be subject to ADA Title III if deployed at places of public accommodation in the US.  
**Question for counsel:** Does the kiosk deployment model (customer-owned hardware, Qflo software) create ADA Title III obligations for Qflo or for the customer? What VPAT/conformance documentation should we maintain?  
**Answer lands in:** `docs/compliance/global.md` US row + vendor contract template.

---

## Priority 4 — Before First Algeria Customer

### Q11. Loi 18-07 controller registration
**Context:** Algeria Loi 18-07 requires data controllers processing Algerian personal data to register with the ANPDP (authority not yet fully operational as of this writing). Addendum at `docs/legal/addendums/dz-loi-18-07.md`.  
**Question for counsel:** Is registration currently required and operational? What is the registration process and timeline?  
**Answer lands in:** `docs/legal/addendums/dz-loi-18-07.md` and `docs/compliance/global.md` Algeria row.

### Q12. Cash-only declaration and VAT/tax invoicing in Algeria
**Context:** Algeria customers currently operate cash-only (no Stripe). Qflo must still issue DZD-denominated VAT invoices (TVA) for its own SaaS subscription fee. The format and filing requirements are unclear.  
**Question for counsel:** What is the correct TVA invoice format for a foreign SaaS provider billing an Algerian business? Is a local fiscal representative required?  
**Answer lands in:** `docs/compliance/global.md` Algeria invoicing row.

### Q13. DZD-currency DPA language
**Context:** The DPA references EUR by default. Algerian customers may require DZD references or Arabised headings to be enforceable.  
**Question for counsel:** Must the DPA be translated to Arabic for enforceability under Algerian law?  
**Answer lands in:** `docs/legal/addendums/dz-loi-18-07.md`.

---

## Priority 5 — Before First Morocco Customer

### Q14. CNDP (Loi 09-08) notification
**Context:** Morocco's Loi 09-08 requires notification or authorisation from CNDP before processing certain categories of personal data. Addendum at `docs/legal/addendums/ma-loi-09-08.md`.  
**Question for counsel:** Does our queue-management processing require CNDP notification or prior authorisation? What is the timeline and process?  
**Answer lands in:** `docs/legal/addendums/ma-loi-09-08.md` and `docs/compliance/global.md` Morocco row.

### Q15. Data transfer to EU servers — Morocco
**Context:** Qflo stores all data in Supabase EU region (Frankfurt). Morocco's Loi 09-08 restricts cross-border transfers.  
**Question for counsel:** Is transfer of Moroccan personal data to EU (Germany) servers permissible under Loi 09-08, and if so, what contractual mechanism is required?  
**Answer lands in:** `docs/legal/addendums/ma-loi-09-08.md` §Transfer.

---

## Priority 6 — Before First India Customer

### Q16. DPDP Data Fiduciary notice requirements
**Context:** India DPDP Act 2023 requires a specific consent notice format. Addendum at `docs/legal/addendums/in-dpdp-2023.md`.  
**Question for counsel:** What must the consent notice contain, and in which languages? Must it be delivered in-app or is a link to the privacy policy sufficient?  
**Answer lands in:** `docs/legal/addendums/in-dpdp-2023.md` and product consent flow (hand-off to engineering).

### Q17. Consent manager integration requirement
**Context:** Draft DPDP rules reference a "Consent Manager" platform registered with DPBI. It is unclear if this applies to B2B SaaS at Qflo's scale.  
**Question for counsel:** Is Qflo required to integrate with a DPBI-registered Consent Manager, or does our own consent log (Supabase `consent_logs` table) suffice?  
**Answer lands in:** `docs/legal/addendums/in-dpdp-2023.md`.

---

## Priority 7 — Ongoing Policy Questions

### Q18. 14-day soft-delete grace period — jurisdictional validity
**Context:** Qflo's data deletion flow uses a 14-day soft-delete before hard deletion, allowing accidental-deletion recovery. GDPR Art. 17 requires erasure "without undue delay."  
**Question for counsel:** Is a 14-day grace period defensible as "without undue delay" under GDPR? Does any active jurisdiction (Algeria, Morocco, India) impose a shorter mandatory erasure window?  
**Answer lands in:** `docs/compliance/global.md` erasure row + engineering runbook.

### Q19. auth.users hard-delete vs PII minimisation for GDPR Art. 17
**Context:** When a customer requests erasure, Qflo deletes PII fields and nulls foreign keys, but Supabase `auth.users` records may remain with just a UUID. We believe this satisfies Art. 17 through pseudonymisation, but it is not a hard delete.  
**Question for counsel:** Is retaining a UUID-only `auth.users` row (no email, no phone, no name) after erasure sufficient for GDPR Art. 17 compliance, or must the row be hard-deleted?  
**Answer lands in:** `docs/compliance/global.md` erasure row + engineering deletion runbook.

### Q20. Data breach notification SLA — non-EU jurisdictions
**Context:** The `incident-response.md` policy lists 72h for EU/UK. SLAs for Algeria, Morocco, India, and US/California are marked "to confirm."  
**Question for counsel:** Please confirm the regulatory breach notification SLA for each active jurisdiction: Algeria (Loi 18-07), Morocco (Loi 09-08), India (DPDP 2023), US/California (CCPA).  
**Answer lands in:** `docs/compliance/soc2/policies/incident-response.md` — Breach Notification SLAs table.

---

## Appendix — Files Referenced

| Document | Path |
|---|---|
| DPA (main) | `docs/legal/data-processing-agreement.md` |
| Algeria addendum | `docs/legal/addendums/dz-loi-18-07.md` |
| Morocco addendum | `docs/legal/addendums/ma-loi-09-08.md` |
| India addendum | `docs/legal/addendums/in-dpdp-2023.md` |
| US/CCPA addendum | `docs/legal/addendums/us-ccpa-colo.md` |
| Global compliance register | `docs/compliance/global.md` |
| Incident response policy | `docs/compliance/soc2/policies/incident-response.md` |
| Accessibility audit | `docs/qa/a11y-audit-2026-04-23.md` |
| SOC 2 kickoff | `docs/compliance/soc2/README.md` |
