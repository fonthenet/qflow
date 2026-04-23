---
name: add-country
description: Scaffold a new country in Qflo — adds country config entry (currency, timezone, holidays, payment provider slot, WhatsApp number slot, greeting dialect slot), creates migration, seeds regional landing page stub. Use when adding a new country to the supported list.
argument-hint: <ISO-2-code> [locale-primary]
disable-model-invocation: true
---

Add the country `$ARGUMENTS` to Qflo's supported country registry.

## Steps

1. **Parse inputs**: first arg = ISO-2 country code (e.g. `MA`, `AE`, `SN`), optional second arg = primary locale (defaults to language common for that country).

2. **Delegate to `qflo-country-launcher`** agent with the full launch checklist for this country:
   - Country config entry (currency, timezone, holidays, regulatory fields)
   - Locale pack (if new language)
   - Payment provider mapping (identify which rail — coordinate with `qflo-payment-integrator`)
   - WhatsApp number provisioning slot
   - Greeting dialect registry entry (if dialect variant)
   - Regional landing page stub
   - Market research summary (`qflo-market-researcher`)
   - Compliance checklist (`qflo-compliance-officer`)

3. **Wait for the launcher to complete** and report back. The launcher itself orchestrates parallel specialist work.

4. **Final verification**: switch a test org to `country: $ARGUMENTS` and confirm:
   - Currency renders correctly
   - Timezone default is applied
   - Country-gated UI appears where expected (payment selector)
   - No non-matching country features leak in

5. **Report**: status of each checklist item, any deferred work with reason.

Do not claim done until every item is green or explicitly deferred with reason. Follow the invariant: shared plan, country overlays — never hardcode the country into core flows.
