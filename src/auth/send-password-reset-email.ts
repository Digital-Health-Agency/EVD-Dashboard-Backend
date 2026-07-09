import * as nodemailer from 'nodemailer';

function getFromAddress(): string {
  const from =
    process.env.MAIL_FROM || process.env.SMTP_FROM || 'noreply@evd.local';
  const fromName = process.env.MAIL_FROM_NAME || 'DHA EVD';
  return `"${fromName}" <${from}>`;
}

function createSmtpTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  if (!host || !portStr) return null;

  const port = parseInt(portStr, 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<{ sent: boolean }> {
  const transporter = createSmtpTransporter();
  if (!transporter) {
    return { sent: false };
  }

  const { to, resetUrl } = params;
  const subject = 'Reset your password';
  const text = `You requested a password reset. Open this link to choose a new password (it expires soon):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
  const safeUrl = escapeHtml(resetUrl);
  const html = `<div style="font-family:Poppins,Arial,Helvetica,sans-serif;margin:0;padding:28px 14px;background:#F5F5F7;color:#0F172A;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;">
    <div style="height:4px;background:#237A2B;"></div>
    <div style="padding:32px;">
      <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">You requested a password reset for your DHA EVD account.</p>
      <p style="margin:24px 0;"><a href="${safeUrl}" style="display:inline-block;background:#237A2B;color:#FFFFFF;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;">Reset your password</a></p>
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#64748B;">If the button does not work, copy and paste this URL into your browser:</p>
      <p style="margin:0 0 18px;word-break:break-all;font-size:13px;color:#334155;">${safeUrl}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#64748B;">If you did not request this, you can ignore this email.</p>
    </div>
  </div>
</div>`;

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });
  return { sent: true };
}
