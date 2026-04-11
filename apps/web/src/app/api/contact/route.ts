import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sanitizeString, isValidEmail } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const { name, email, company, phone, message } = await request.json();

    if (!name || !email || !message) {
      return NextResponse.json(
        { error: 'Name, email, and message are required' },
        { status: 400 }
      );
    }

    // ── Input validation ──────────────────────────────────────────
    const cleanName = sanitizeString(name, 200);
    if (!cleanName) {
      return NextResponse.json({ error: 'name must be a non-empty string (max 200 chars)' }, { status: 400 });
    }
    if (typeof email !== 'string' || !isValidEmail(email)) {
      return NextResponse.json({ error: 'A valid email address is required (max 254 chars)' }, { status: 400 });
    }
    const cleanMessage = sanitizeString(message, 5000);
    if (!cleanMessage) {
      return NextResponse.json({ error: 'message must be a non-empty string (max 5000 chars)' }, { status: 400 });
    }
    const cleanCompany = company ? sanitizeString(company, 200) : null;
    const cleanPhone = phone ? sanitizeString(phone, 30) : null;

    const supabase = await createClient();

    const { error } = await supabase.from('contact_submissions').insert({
      name: cleanName,
      email: email.trim(),
      company: cleanCompany || null,
      phone: cleanPhone || null,
      message: cleanMessage,
    });

    if (error) {
      console.error('Contact form error:', error);
      return NextResponse.json(
        { error: 'Failed to submit message. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
