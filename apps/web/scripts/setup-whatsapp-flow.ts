#!/usr/bin/env tsx
/**
 * setup-whatsapp-flow.ts — Create & publish the QFlow booking Flow in Meta.
 *
 * Usage:
 *   WHATSAPP_META_ACCESS_TOKEN=... WHATSAPP_WABA_ID=... tsx scripts/setup-whatsapp-flow.ts
 *
 * After running, copy the printed WHATSAPP_FLOW_ID into your .env / Vercel env vars.
 *
 * To update an existing flow:
 *   WHATSAPP_FLOW_ID=existing-id WHATSAPP_META_ACCESS_TOKEN=... tsx scripts/setup-whatsapp-flow.ts
 */

const GRAPH_API = 'https://graph.facebook.com/v22.0';

const accessToken = process.env.WHATSAPP_META_ACCESS_TOKEN?.trim();
const wabaId = process.env.WHATSAPP_WABA_ID?.trim();
const existingFlowId = process.env.WHATSAPP_FLOW_ID?.trim();

if (!accessToken) {
  console.error('Missing WHATSAPP_META_ACCESS_TOKEN');
  process.exit(1);
}
if (!wabaId && !existingFlowId) {
  console.error('Missing WHATSAPP_WABA_ID (needed to create a new flow)');
  process.exit(1);
}

// Build flow JSON (inline to avoid importing server-only modules)
const flowJson = {
  version: '6.0',
  screens: [
    {
      id: 'SELECT_SLOT',
      title: 'Book Appointment',
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.heading}' },
          { type: 'TextBody', text: '${data.subheading}' },
          {
            type: 'RadioButtonsGroup',
            name: 'slot',
            label: '${data.slot_label}',
            required: true,
            'data-source': '${data.slots}',
          },
          {
            type: 'Footer',
            label: '${data.next_label}',
            'on-click-action': {
              name: 'navigate',
              next: { type: 'screen', name: 'CUSTOMER_INFO' },
              payload: {
                slot: '${form.slot}',
                ctx: '${data.ctx}',
                heading: '${data.confirm_heading}',
                name_label: '${data.name_label}',
                name_hint: '${data.name_hint}',
                wilaya_label: '${data.wilaya_label}',
                reason_label: '${data.reason_label}',
                confirm_label: '${data.confirm_label}',
                wilayas: '${data.wilayas}',
              },
            },
          },
        ],
      },
      data: {
        ctx: { type: 'string', __example__: 'org|office|fr' },
        heading: { type: 'string', __example__: 'Clinic' },
        subheading: { type: 'string', __example__: 'Choose a slot' },
        slot_label: { type: 'string', __example__: 'Slots' },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' } },
            required: ['id', 'title'],
          },
          __example__: [{ id: '1|2|2026-04-15|09:00', title: 'Apr 15 — 09:00' }],
        },
        next_label: { type: 'string', __example__: 'Next' },
        confirm_heading: { type: 'string', __example__: 'Info' },
        name_label: { type: 'string', __example__: 'Name' },
        name_hint: { type: 'string', __example__: 'e.g. Ahmed' },
        wilaya_label: { type: 'string', __example__: 'Province' },
        reason_label: { type: 'string', __example__: 'Reason' },
        confirm_label: { type: 'string', __example__: 'Confirm' },
        wilayas: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' } },
            required: ['id', 'title'],
          },
          __example__: [{ id: '16-Alger', title: '16 - Alger' }],
        },
      },
    },
    {
      id: 'CUSTOMER_INFO',
      title: 'Your Information',
      terminal: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.heading}' },
          {
            type: 'TextInput',
            name: 'customer_name',
            label: '${data.name_label}',
            'helper-text': '${data.name_hint}',
            required: true,
            'input-type': 'text',
            'min-chars': 2,
            'max-chars': 100,
          },
          {
            type: 'Dropdown',
            name: 'wilaya',
            label: '${data.wilaya_label}',
            required: false,
            'data-source': '${data.wilayas}',
          },
          {
            type: 'TextArea',
            name: 'reason',
            label: '${data.reason_label}',
            required: false,
            'max-length': 200,
          },
          {
            type: 'Footer',
            label: '${data.confirm_label}',
            'on-click-action': {
              name: 'complete',
              payload: {
                slot: '${data.slot}',
                ctx: '${data.ctx}',
                customer_name: '${form.customer_name}',
                wilaya: '${form.wilaya}',
                reason: '${form.reason}',
              },
            },
          },
        ],
      },
      data: {
        slot: { type: 'string', __example__: '1|2|2026-04-15|09:00' },
        ctx: { type: 'string', __example__: 'org|office|fr' },
        heading: { type: 'string', __example__: 'Info' },
        name_label: { type: 'string', __example__: 'Name' },
        name_hint: { type: 'string', __example__: 'e.g. Ahmed' },
        wilaya_label: { type: 'string', __example__: 'Province' },
        reason_label: { type: 'string', __example__: 'Reason' },
        confirm_label: { type: 'string', __example__: 'Confirm' },
        wilayas: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' } },
            required: ['id', 'title'],
          },
          __example__: [{ id: '16-Alger', title: '16 - Alger' }],
        },
      },
    },
  ],
};

async function createFlow(): Promise<string> {
  console.log('Creating new WhatsApp Flow...');
  const res = await fetch(`${GRAPH_API}/${wabaId}/flows`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'QFlow Booking',
      categories: ['APPOINTMENT_BOOKING'],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to create flow:', data.error?.message || data);
    process.exit(1);
  }

  console.log('Flow created:', data.id);
  return data.id;
}

async function uploadFlowJson(flowId: string): Promise<void> {
  console.log('Uploading flow JSON...');

  // Meta expects multipart form-data with a file named "flow.json"
  const blob = new Blob([JSON.stringify(flowJson)], { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', blob, 'flow.json');
  formData.append('name', 'flow.json');
  formData.append('asset_type', 'FLOW_JSON');

  const res = await fetch(`${GRAPH_API}/${flowId}/assets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to upload flow JSON:', data.error?.message || data);
    if (data.error?.error_user_title) {
      console.error('Details:', data.error.error_user_title);
    }
    if (data.error?.error_data?.details) {
      console.error('Validation errors:', JSON.stringify(data.error.error_data.details, null, 2));
    }
    process.exit(1);
  }

  console.log('Flow JSON uploaded successfully');
}

async function publishFlow(flowId: string): Promise<void> {
  console.log('Publishing flow...');
  const res = await fetch(`${GRAPH_API}/${flowId}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to publish flow:', data.error?.message || data);
    console.log('\nThe flow was created and uploaded but NOT published.');
    console.log('You can publish it manually from Meta Business Suite or re-run this script.');
    return;
  }

  console.log('Flow published successfully!');
}

async function main() {
  const flowId = existingFlowId || await createFlow();

  await uploadFlowJson(flowId);
  await publishFlow(flowId);

  console.log('\n════════════════════════════════════════');
  console.log('  Add this to your .env / Vercel:');
  console.log(`  WHATSAPP_FLOW_ID=${flowId}`);
  console.log('════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
