import { BrowserWindow } from 'electron';

interface TicketData {
  ticketNumber: string;
  qrCodeUrl: string;
  serviceName: string;
  departmentName: string;
  officeName: string;
  timestamp: string;
}

function generateTicketHTML(data: TicketData): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: 'Courier New', monospace;
            width: 80mm;
            padding: 4mm;
            text-align: center;
          }
          .header {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
            border-bottom: 2px dashed #000;
            padding-bottom: 8px;
          }
          .ticket-number {
            font-size: 48px;
            font-weight: bold;
            margin: 16px 0;
            letter-spacing: 4px;
          }
          .qr-code {
            margin: 12px auto;
          }
          .qr-code img {
            width: 120px;
            height: 120px;
          }
          .info {
            font-size: 12px;
            margin: 4px 0;
            text-align: left;
          }
          .info strong {
            display: inline-block;
            width: 80px;
          }
          .timestamp {
            font-size: 11px;
            margin-top: 12px;
            color: #333;
            border-top: 1px dashed #000;
            padding-top: 8px;
          }
          .footer {
            font-size: 10px;
            margin-top: 8px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="header">QueueFlow</div>
        <div class="ticket-number">${escapeHtml(data.ticketNumber)}</div>
        <div class="qr-code">
          <img src="${escapeHtml(data.qrCodeUrl)}" alt="QR Code" />
        </div>
        <div class="info"><strong>Service:</strong> ${escapeHtml(data.serviceName)}</div>
        <div class="info"><strong>Dept:</strong> ${escapeHtml(data.departmentName)}</div>
        <div class="info"><strong>Office:</strong> ${escapeHtml(data.officeName)}</div>
        <div class="timestamp">${escapeHtml(data.timestamp)}</div>
        <div class="footer">Thank you for waiting. Your turn will be called.</div>
      </body>
    </html>
  `;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

export async function printTicket(data: TicketData): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 302, // ~80mm at 96dpi
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const html = generateTicketHTML(data);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    win.webContents.on('did-finish-load', () => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          margins: {
            marginType: 'none',
          },
        },
        (success: boolean, failureReason: string) => {
          win.close();
          if (success) {
            console.log('Ticket printed successfully');
            resolve();
          } else {
            console.error('Print failed:', failureReason);
            reject(new Error(`Print failed: ${failureReason}`));
          }
        }
      );
    });

    win.webContents.on('did-fail-load', (_event: any, errorCode: number, errorDescription: string) => {
      win.close();
      reject(new Error(`Failed to load print template: ${errorDescription} (${errorCode})`));
    });
  });
}
