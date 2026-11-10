import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail, type EmailMessage } from '../services/emailService.js';

const config = {
  smtpUser: 'launchboard.notifications@gmail.com',
  smtpPassword: 'abcdEFGH12345678',
  appBaseUrl: 'https://launchboard.example',
};

const message: EmailMessage = {
  to: 'person@example.test',
  subject: 'Verify your email',
  text: 'Open this link to verify your email: https://launchboard.example/#verifyEmail=secret-token',
  html: '<p>Verify your email</p>',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendEmail', () => {
  it('sends through Gmail SMTP over implicit TLS and awaits message delivery', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'message-id' });
    const close = vi.fn();
    const transport = { sendMail, close };
    const createTransport = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue(transport as never);

    await sendEmail(config, message);

    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword,
      },
    }));
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith({
      from: {
        name: 'Launchboard',
        address: config.smtpUser,
      },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('hides SMTP response details and always closes the transport after a failure', async () => {
    const sendMail = vi.fn().mockRejectedValue(
      new Error('private SMTP detail abcdEFGH12345678'),
    );
    const close = vi.fn();
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue(
      { sendMail, close } as never,
    );

    await expect(sendEmail(config, message)).rejects.toThrow(
      'Email delivery is unavailable.',
    );
    await expect(sendEmail(config, message)).rejects.not.toThrow(
      'private SMTP detail',
    );
    expect(close).toHaveBeenCalled();
  });
});
