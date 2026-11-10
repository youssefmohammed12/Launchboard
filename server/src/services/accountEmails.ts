import type { EmailServiceConfig } from '../config/env.js';
import type { EmailMessage } from './emailService.js';

type PasswordChangeSource = 'password-reset' | 'account-settings';

function actionUrl(
  config: EmailServiceConfig,
  parameter: 'verifyEmail' | 'resetPassword',
  token: string,
): string {
  const url = new URL('/', config.appBaseUrl);
  // Tokens remain in the fragment, so they are not sent in the initial HTTP request.
  url.hash = new URLSearchParams([[parameter, token]]).toString();
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    // Keep the API catch-all compatible with the Vercel ES2020 TypeScript target.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface AccountEmailContent {
  preheader: string;
  eyebrow: string;
  heading: string;
  introduction: string;
  buttonLabel?: string;
  buttonUrl?: string;
  details: string[];
  notice?: string;
  reason: string;
}

function renderHtml(content: AccountEmailContent): string {
  const details = content.details
    .map((detail) => `<p style="margin:0 0 10px;color:#52636a;font-size:14px;line-height:1.7;">${escapeHtml(detail)}</p>`)
    .join('');
  const button = content.buttonLabel && content.buttonUrl
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 20px;">
        <tr>
          <td align="center" bgcolor="#087f78" style="border-radius:8px;">
            <a href="${escapeHtml(content.buttonUrl)}" target="_blank" style="display:inline-block;padding:14px 24px;border:1px solid #087f78;border-radius:8px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeHtml(content.buttonLabel)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;color:#68777d;font-size:12px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="margin:0 0 22px;overflow-wrap:anywhere;color:#087f78;font-size:12px;line-height:1.7;"><a href="${escapeHtml(content.buttonUrl)}" target="_blank" style="color:#087f78;text-decoration:underline;">${escapeHtml(content.buttonUrl)}</a></p>
    `
    : '';
  const notice = content.notice
    ? `<tr><td style="padding:17px 20px;background:#f2f7f7;border:1px solid #e2eceb;border-radius:8px;"><p style="margin:0;color:#53656a;font-size:13px;line-height:1.7;">${escapeHtml(content.notice)}</p></td></tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(content.heading)} | Launchboard</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f5;font-family:Arial,Helvetica,sans-serif;color:#172e32;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f1f5f5;">
    <tr>
      <td align="center" style="padding:38px 16px 34px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="padding:0 0 18px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="40" height="40" align="center" valign="middle" bgcolor="#123d3d" style="width:40px;height:40px;border-radius:10px;background-color:#123d3d;color:#ffffff;font-size:20px;font-weight:700;line-height:40px;">L</td>
                  <td style="padding-left:11px;">
                    <p style="margin:0;color:#123d3d;font-size:19px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;">Launchboard</p>
                    <p style="margin:4px 0 0;color:#718187;font-size:10px;font-weight:700;letter-spacing:1.5px;line-height:1.2;">YOUR OPPORTUNITY WORKSPACE</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 38px 34px;background-color:#ffffff;border:1px solid #e1e9e8;border-radius:13px;">
              <p style="margin:0 0 12px;color:#087f78;font-size:11px;font-weight:700;letter-spacing:1.5px;line-height:1.4;">${escapeHtml(content.eyebrow.toUpperCase())}</p>
              <h1 style="margin:0 0 16px;color:#15383b;font-size:27px;font-weight:700;letter-spacing:-0.7px;line-height:1.25;">${escapeHtml(content.heading)}</h1>
              <p style="margin:0;color:#52636a;font-size:15px;line-height:1.8;">${escapeHtml(content.introduction)}</p>
              ${button}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:4px;">
                <tr><td style="padding:20px 0 0;border-top:1px solid #edf1f1;">${details}</td></tr>
                ${notice}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 16px 0;">
              <p style="margin:0 0 7px;color:#78878c;font-size:12px;line-height:1.6;">This is an automated message from Launchboard. Please do not reply.</p>
              <p style="margin:0 0 7px;color:#78878c;font-size:12px;line-height:1.6;">${escapeHtml(content.reason)}</p>
              <p style="margin:0;color:#9aa5a9;font-size:11px;line-height:1.6;">© Launchboard · Your opportunities, organized.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function createMessage(
  to: string,
  subject: string,
  content: AccountEmailContent,
  textLines: string[],
): EmailMessage {
  return {
    to,
    subject,
    text: [...textLines, '', content.reason].join('\n'),
    html: renderHtml(content),
  };
}

export function createVerificationEmail(
  config: EmailServiceConfig,
  email: string,
  token: string,
): EmailMessage {
  const url = actionUrl(config, 'verifyEmail', token);
  return createMessage(
    email,
    'Verify your Launchboard email address',
    {
      preheader: 'One quick step to finish setting up your Launchboard account.',
      eyebrow: 'WELCOME TO LAUNCHBOARD',
      heading: 'Verify your email address',
      introduction: 'Thanks for creating a Launchboard account. Confirm your email address to finish setting up your account and keep it secure.',
      buttonLabel: 'Verify email address',
      buttonUrl: url,
      details: [
        'This verification link expires in 24 hours and can only be used once.',
        'Once your email is verified, you can sign in and start organizing your opportunities.',
      ],
      notice: 'Did not create a Launchboard account? You can safely ignore this email. No account will be activated through this message unless the verification link is used.',
      reason: 'You received this email because you created a Launchboard account with this address.',
    },
    [
      'Welcome to Launchboard',
      '',
      'Verify your email address',
      'Thanks for creating a Launchboard account. Confirm your email address to finish setting up your account and keep it secure.',
      '',
      url,
      '',
      'This verification link expires in 24 hours and can only be used once.',
      'Once your email is verified, you can sign in and start organizing your opportunities.',
      '',
      'Did not create a Launchboard account? You can safely ignore this email.',
    ],
  );
}

export function createPasswordResetEmail(
  config: EmailServiceConfig,
  email: string,
  token: string,
): EmailMessage {
  const url = actionUrl(config, 'resetPassword', token);
  return createMessage(
    email,
    'Reset your Launchboard password',
    {
      preheader: 'Use the secure link to choose a new password for your account.',
      eyebrow: 'ACCOUNT SECURITY',
      heading: 'Reset your password',
      introduction: 'We received a request to reset the password for your Launchboard account. Use the secure button below to choose a new password.',
      buttonLabel: 'Reset password',
      buttonUrl: url,
      details: [
        'This password-reset link expires in 1 hour and can only be used once.',
        'For your security, you will be asked to sign in again after your password has been changed.',
      ],
      notice: 'If you did not request a password reset, you can ignore this email. Your current password will remain unchanged.',
      reason: 'You received this email because a password reset was requested for your Launchboard account.',
    },
    [
      'Launchboard password reset',
      '',
      'A password reset was requested for your Launchboard account.',
      '',
      url,
      '',
      'This password-reset link expires in 1 hour and can only be used once.',
      'For your security, you will be asked to sign in again after your password has been changed.',
      '',
      'If you did not request a password reset, you can ignore this email. Your current password will remain unchanged.',
    ],
  );
}

export function createPasswordChangedEmail(
  email: string,
  appBaseUrl: string,
  source: PasswordChangeSource,
): EmailMessage {
  const fromSettings = source === 'account-settings';
  const heading = fromSettings ? 'Your password has been changed' : 'Your password has been reset';
  const introduction = fromSettings
    ? 'The password for your Launchboard account was changed from Account Settings.'
    : 'The password for your Launchboard account was successfully updated using a password-reset link.';
  const details = fromSettings
    ? [
        'Other active sign-in sessions were revoked. This browser remains signed in.',
        'You can continue using Launchboard with your new password.',
      ]
    : [
        'For your security, all existing sign-in sessions were signed out.',
        'Sign in to Launchboard using your new password.',
      ];
  const url = new URL('/', appBaseUrl).toString();

  return createMessage(
    email,
    fromSettings ? 'Your Launchboard password was changed' : 'Your Launchboard password was reset',
    {
      preheader: 'A security update was made to your Launchboard account.',
      eyebrow: 'SECURITY NOTIFICATION',
      heading,
      introduction,
      buttonLabel: 'Open Launchboard',
      buttonUrl: url,
      details,
      notice: 'If you did not make this change, reset your password immediately using the “Forgot password?” option on the sign-in page.',
      reason: 'You received this email because your Launchboard account password was changed.',
    },
    [
      heading,
      '',
      introduction,
      ...details,
      '',
      `Open Launchboard: ${url}`,
      '',
      'If you did not make this change, reset your password immediately using the “Forgot password?” option on the sign-in page.',
    ],
  );
}
