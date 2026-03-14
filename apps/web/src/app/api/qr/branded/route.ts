import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/qr/branded?url=...&org_id=...&size=300
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const orgId = searchParams.get('org_id');
  const size = Math.min(parseInt(searchParams.get('size') || '300'), 1000);

  if (!url) {
    return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
  }

  let primaryColor = '#111827';
  let logoUrl: string | null = null;

  // If org_id is provided, use their branding
  if (orgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('logo_url, settings')
      .eq('id', orgId)
      .single();

    if (org) {
      const settings = (org.settings as Record<string, any>) || {};
      primaryColor = settings.brand_primary_color || '#111827';
      logoUrl = org.logo_url;
    }
  }

  // Generate QR code as SVG
  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    width: size,
    margin: 2,
    color: {
      dark: primaryColor,
      light: '#ffffff',
    },
    errorCorrectionLevel: logoUrl ? 'H' : 'M', // Higher correction for logo overlay
  });

  // If logo exists, embed it in the center of the SVG
  let finalSvg = qrSvg;
  if (logoUrl) {
    const logoSize = Math.round(size * 0.22);
    const logoOffset = Math.round((size - logoSize) / 2);
    const padding = 4;

    // Insert logo overlay before closing </svg>
    const logoOverlay = `
      <rect x="${logoOffset - padding}" y="${logoOffset - padding}"
            width="${logoSize + padding * 2}" height="${logoSize + padding * 2}"
            rx="8" fill="white"/>
      <image x="${logoOffset}" y="${logoOffset}"
             width="${logoSize}" height="${logoSize}"
             href="${logoUrl}"
             preserveAspectRatio="xMidYMid meet"/>
    `;
    finalSvg = finalSvg.replace('</svg>', `${logoOverlay}</svg>`);
  }

  return new NextResponse(finalSvg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
