import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'QueueFlow <noreply@queueflow.com>';

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendTicketCalledEmail(to: string, data: {
  customerName: string;
  ticketNumber: string;
  deskName: string;
  officeName: string;
}) {
  if (!isEmailConfigured()) return;

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Your number ${data.ticketNumber} has been called`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">
          It's your turn!
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
          ${data.officeName}
        </p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">
            Your Number
          </p>
          <p style="font-size: 36px; font-weight: 700; color: #111827; margin: 0;">
            ${data.ticketNumber}
          </p>
        </div>
        <p style="font-size: 14px; color: #374151; margin: 0 0 8px;">
          Hi ${data.customerName},
        </p>
        <p style="font-size: 14px; color: #374151; margin: 0 0 24px;">
          Please proceed to <strong>${data.deskName}</strong>. Your number has been called.
        </p>
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Powered by QueueFlow
        </p>
      </div>
    `,
  });
}

export async function sendAppointmentReminderEmail(to: string, data: {
  customerName: string;
  serviceName: string;
  scheduledAt: string;
  officeName: string;
}) {
  if (!isEmailConfigured()) return;

  const date = new Date(data.scheduledAt);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Appointment reminder: ${data.serviceName} on ${formattedDate}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">
          Appointment Reminder
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
          ${data.officeName}
        </p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 4px;">
            <strong>Service:</strong> ${data.serviceName}
          </p>
          <p style="font-size: 14px; color: #374151; margin: 0 0 4px;">
            <strong>Date:</strong> ${formattedDate}
          </p>
          <p style="font-size: 14px; color: #374151; margin: 0;">
            <strong>Time:</strong> ${formattedTime}
          </p>
        </div>
        <p style="font-size: 14px; color: #374151; margin: 0 0 24px;">
          Hi ${data.customerName}, this is a reminder about your upcoming appointment. Please arrive on time.
        </p>
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Powered by QueueFlow
        </p>
      </div>
    `,
  });
}

export async function sendTicketIssuedEmail(to: string, data: {
  customerName: string;
  ticketNumber: string;
  estimatedWait: number | null;
  officeName: string;
  trackingUrl: string;
}) {
  if (!isEmailConfigured()) return;

  const waitText = data.estimatedWait
    ? `Estimated wait: ~${data.estimatedWait} minutes.`
    : 'We will notify you when it\'s your turn.';

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `Your ticket ${data.ticketNumber} — ${data.officeName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">
          You're in the queue
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
          ${data.officeName}
        </p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">
            Your Number
          </p>
          <p style="font-size: 36px; font-weight: 700; color: #111827; margin: 0;">
            ${data.ticketNumber}
          </p>
        </div>
        <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
          Hi ${data.customerName}, you have been added to the queue. ${waitText}
        </p>
        <a href="${data.trackingUrl}" style="display: inline-block; background: #111827; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">
          Track your position
        </a>
        <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0;">
          Powered by QueueFlow
        </p>
      </div>
    `,
  });
}

export async function sendStaffAlertEmail(to: string, data: {
  alertType: 'queue_threshold' | 'no_show' | 'long_wait';
  message: string;
  officeName: string;
}) {
  if (!isEmailConfigured()) return;

  const subjectMap = {
    queue_threshold: 'Queue alert: High volume',
    no_show: 'No-show alert',
    long_wait: 'Long wait time alert',
  };

  await getResend().emails.send({
    from: FROM_EMAIL,
    to,
    subject: `${subjectMap[data.alertType]} — ${data.officeName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">
          ${subjectMap[data.alertType]}
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
          ${data.officeName}
        </p>
        <div style="background: #fef3c7; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 14px; color: #92400e; margin: 0;">
            ${data.message}
          </p>
        </div>
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Powered by QueueFlow
        </p>
      </div>
    `,
  });
}
