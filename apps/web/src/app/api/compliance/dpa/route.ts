import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Serves the DPA markdown template as a downloadable file.
 * Only accessible to authenticated admin users (enforced by the middleware /
 * calling context in production). For now it's a static file serve.
 *
 * TODO: Gate this behind requireOrganizationAdmin once the download link
 * is exclusively used from the authenticated admin dashboard.
 */
export async function GET() {
  try {
    // Resolve from the repo root — the docs/legal directory is at the monorepo root.
    const repoRoot = path.resolve(process.cwd(), '..', '..');
    const dpaPath = path.join(repoRoot, 'docs', 'legal', 'data-processing-agreement.md');

    const content = fs.readFileSync(dpaPath, 'utf-8');

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="qflo-data-processing-agreement.md"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'DPA template not found' }, { status: 404 });
  }
}
