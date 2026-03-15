import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { hasFeature, type PlanId } from '@/lib/plan-limits';

let _supabase: SupabaseClient | null = null;
function getServiceClient(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export interface ApiContext {
  organizationId: string;
  planId: PlanId;
}

export async function authenticateApiRequest(
  request: NextRequest
): Promise<{ ctx: ApiContext } | { error: NextResponse }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Missing or invalid Authorization header. Use: Bearer <api_key>' },
        { status: 401 }
      ),
    };
  }

  const apiKey = authHeader.slice(7);

  // Look up the API key
  const supabase = getServiceClient();

  const { data: keyRecord } = await supabase
    .from('api_keys')
    .select('organization_id, is_active')
    .eq('key_hash', hashApiKey(apiKey))
    .single();

  if (!keyRecord || !keyRecord.is_active) {
    return {
      error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }),
    };
  }

  // Update last used
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hashApiKey(apiKey));

  // Get organization plan
  const { data: org } = await supabase
    .from('organizations')
    .select('plan_id')
    .eq('id', keyRecord.organization_id)
    .single();

  const planId = (org?.plan_id || 'free') as PlanId;

  if (!hasFeature(planId, 'rest_api')) {
    return {
      error: NextResponse.json(
        { error: 'REST API access requires a Growth plan or higher' },
        { status: 403 }
      ),
    };
  }

  return {
    ctx: {
      organizationId: keyRecord.organization_id,
      planId,
    },
  };
}

// Simple SHA-256 hash for API key storage
export function hashApiKey(key: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): string {
  const crypto = require('crypto');
  return `qf_${crypto.randomBytes(32).toString('hex')}`;
}
