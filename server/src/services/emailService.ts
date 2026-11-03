import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailServiceConfig } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super('Email delivery is unavailable.');
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Send one transactional email through Gmail SMTP.
 *
 * Gmail uses implicit TLS on port 465. Sending is awaited before the API
 * response completes because Vercel may pause background work after return.
 * Provider errors are intentionally replaced with a safe generic error.
 */
export async function sendEmail(
  config: EmailServiceConfig,
  message: EmailMessage,
): Promise<void> {
  let transporter: Transporter | undefined;

  try {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    await transporter.sendMail({
      from: {
        name: 'Launchboard',
        address: config.smtpUser,
      },
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } catch {
    // Do not retain the SMTP/provider error; it may contain request details.
    throw new EmailDeliveryError();
  } finally {
    transporter?.close();
  }
}
