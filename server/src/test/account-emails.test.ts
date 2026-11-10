import { describe, expect, it } from 'vitest';
import {
  createPasswordChangedEmail,
  createPasswordResetEmail,
  createVerificationEmail,
} from '../services/accountEmails.js';

const config = {
  smtpUser: 'launchboard.notifications@gmail.com',
  smtpPassword: 'not-a-real-password',
  appBaseUrl: 'https://launchboard.example',
};

describe('branded account email templates', () => {
  it('creates a welcome email with a verification CTA and safe text fallback', () => {
    const message = createVerificationEmail(config, 'person@example.test', 'verification-token');

    expect(message.subject).toBe('Verify your Launchboard email address');
    expect(message.text).toContain('https://launchboard.example/#verifyEmail=verification-token');
    expect(message.text).toContain('24 hours');
    expect(message.html).toContain('Launchboard');
    expect(message.html).toContain('Verify email address');
    expect(message.html).toContain('href="https://launchboard.example/#verifyEmail=verification-token"');
    expect(message.html).toContain('24 hours');
    expect(message.html).toContain('Did not create a Launchboard account?');
    expect(message.html).toContain('You received this email because you created a Launchboard account with this address.');
    expect(message.text).toContain('You received this email because you created a Launchboard account with this address.');
  });

  it('creates a password reset email with the one-hour, single-use guidance', () => {
    const message = createPasswordResetEmail(config, 'person@example.test', 'reset-token');

    expect(message.subject).toBe('Reset your Launchboard password');
    expect(message.text).toContain('https://launchboard.example/#resetPassword=reset-token');
    expect(message.text).toContain('1 hour');
    expect(message.html).toContain('Reset password');
    expect(message.html).toContain('href="https://launchboard.example/#resetPassword=reset-token"');
    expect(message.html).toContain('Your current password will remain unchanged');
    expect(message.html).toContain('You received this email because a password reset was requested for your Launchboard account.');
    expect(message.text).toContain('You received this email because a password reset was requested for your Launchboard account.');
  });

  it('creates distinct password-change notices for resets and settings updates', () => {
    const reset = createPasswordChangedEmail(
      'person@example.test',
      config.appBaseUrl,
      'password-reset',
    );
    const settings = createPasswordChangedEmail(
      'person@example.test',
      config.appBaseUrl,
      'account-settings',
    );

    expect(reset.subject).toBe('Your Launchboard password was reset');
    expect(reset.html).toContain('all existing sign-in sessions were signed out');
    expect(settings.subject).toBe('Your Launchboard password was changed');
    expect(settings.html).toContain('This browser remains signed in');
    expect(reset.html).toContain('If you did not make this change');
    expect(settings.html).toContain('If you did not make this change');
    expect(reset.text).toContain('You received this email because your Launchboard account password was changed.');
    expect(settings.text).toContain('You received this email because your Launchboard account password was changed.');
  });

  it('keeps token content URL-encoded rather than treating it as HTML', () => {
    const message = createVerificationEmail(
      config,
      'person@example.test',
      '<script>alert(1)</script>',
    );

    expect(message.html).toContain('%3Cscript%3Ealert%281%29%3C%2Fscript%3E');
    expect(message.html).not.toContain('<script>alert(1)</script>');
  });
});
