'use client';

import { useRef } from 'react';

interface QrPosterProps {
  businessName: string;
  logoUrl?: string;
  qrUrl: string;
  departmentName?: string;
}

export function QrPoster({ businessName, logoUrl, qrUrl, departmentName }: QrPosterProps) {
  const posterRef = useRef<HTMLDivElement>(null);

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}&margin=0`;

  function handlePrint() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const posterHtml = posterRef.current?.innerHTML ?? '';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>QR Poster - ${businessName}</title>
        <style>
          @page { size: A4; margin: 0; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 210mm; height: 297mm; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
          body { display: flex; align-items: center; justify-content: center; }
          .poster-container { width: 210mm; height: 297mm; padding: 20mm 20mm 15mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
          .no-print { display: none !important; }
        </style>
      </head>
      <body>
        <div class="poster-container">${posterHtml}</div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  return (
    <div>
      {/* Print button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }} className="no-print">
        <button
          onClick={handlePrint}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 32px',
            fontSize: 16,
            fontWeight: 600,
            color: '#fff',
            backgroundColor: '#2563eb',
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#1d4ed8')}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Print Poster
        </button>
      </div>

      {/* Poster preview */}
      <div
        ref={posterRef}
        style={{
          width: 595,
          minHeight: 842,
          margin: '0 auto',
          padding: '60px 60px 40px',
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        {/* Top section: logo + business name */}
        <div style={{ textAlign: 'center', width: '100%' }}>
          {logoUrl && (
            <div style={{ marginBottom: 16 }}>
              <img
                src={logoUrl}
                alt={businessName}
                style={{
                  maxWidth: 120,
                  maxHeight: 120,
                  objectFit: 'contain',
                }}
              />
            </div>
          )}
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: '#111827',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              marginBottom: departmentName ? 8 : 0,
            }}
          >
            {businessName}
          </h1>
          {departmentName && (
            <p
              style={{
                fontSize: 18,
                fontWeight: 500,
                color: '#6b7280',
                letterSpacing: '0.02em',
              }}
            >
              {departmentName}
            </p>
          )}
        </div>

        {/* Middle section: CTA + QR */}
        <div style={{ textAlign: 'center', width: '100%' }}>
          {/* Multilingual call to action */}
          <div style={{ marginBottom: 32 }}>
            <p
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: '#111827',
                marginBottom: 8,
                lineHeight: 1.3,
              }}
            >
              Scan to Join the Queue
            </p>
            <p
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: '#4b5563',
                marginBottom: 6,
                lineHeight: 1.3,
              }}
            >
              Scannez pour rejoindre la file
            </p>
            <p
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: '#4b5563',
                direction: 'rtl',
                lineHeight: 1.5,
              }}
            >
              {'\u0627\u0645\u0633\u062D \u0644\u0644\u0627\u0646\u0636\u0645\u0627\u0645 \u0625\u0644\u0649 \u0637\u0627\u0628\u0648\u0631 \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631'}
            </p>
          </div>

          {/* QR Code */}
          <div
            style={{
              display: 'inline-block',
              padding: 20,
              backgroundColor: '#ffffff',
              border: '3px solid #111827',
              borderRadius: 16,
            }}
          >
            <img
              src={qrImageUrl}
              alt="QR Code"
              style={{ width: 280, height: 280, display: 'block' }}
            />
          </div>

          {/* URL below QR */}
          <p
            style={{
              marginTop: 20,
              fontSize: 13,
              color: '#9ca3af',
              wordBreak: 'break-all',
              maxWidth: 400,
              marginLeft: 'auto',
              marginRight: 'auto',
              lineHeight: 1.4,
            }}
          >
            {qrUrl}
          </p>
        </div>

        {/* Bottom section: branding line */}
        <div style={{ textAlign: 'center', width: '100%' }}>
          <div
            style={{
              width: 60,
              height: 3,
              backgroundColor: '#e5e7eb',
              margin: '0 auto 12px',
              borderRadius: 2,
            }}
          />
          <p
            style={{
              fontSize: 12,
              color: '#d1d5db',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Powered by QFlow
          </p>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}

export default QrPoster;
