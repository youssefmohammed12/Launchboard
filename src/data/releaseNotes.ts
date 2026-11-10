export interface ReleaseNoteSection {
  heading: 'Added' | 'Improved' | 'Fixed';
  items: string[];
}

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  summary: string;
  sections: ReleaseNoteSection[];
  spotlight?: 'quick-capture';
  accountModeNote?: string;
}

/**
 * Product-facing release history. Keep this focused on what users can do,
 * not internal implementation details or deployment verification.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.3.5',
    date: 'November 10, 2026',
    title: 'Manage your Launchboard account',
    summary:
      'Account Settings brings your profile and sign-in controls together, while clearer branded emails keep important account actions easy to recognise.',
    accountModeNote:
      'Account Settings is available in signed-in account mode. Browser-only local workspaces remain independent and do not need an account.',
    sections: [
      {
        heading: 'Added',
        items: [
          'Choose or update the display name shown in your Launchboard account. Your sign-in email remains visible and read-only.',
          'Change your password after confirming your current password. Your current browser stays signed in while other active sessions are signed out.',
          'Permanently delete your account after re-entering your password and typing DELETE as confirmation. Export a JSON backup first because account data removal cannot be undone.',
        ],
      },
      {
        heading: 'Improved',
        items: [
          'Account verification, verification resend, password reset and password-change emails now share a consistent Launchboard design with responsive HTML and plain-text versions.',
          'Important account emails include clear action wording, expiry or security notices, and a copy-and-paste link when a button is unavailable.',
          'Password changes made from Settings send a security notification without cancelling the password change if email delivery is unavailable.',
          'Opportunity types now include Contract, and new records require an explicit type choice instead of assuming Internship.',
          'Job details keep employer work mode, physical locations and employment type separate. Saved posting links are cleaned of UTM campaign parameters without discarding meaningful query data.',
          'Quick Capture is more selective about generic careers/marketing pages and keeps unsupported links ready for manual entry.',
          'Calendar month events identify their opportunity, and the Dashboard seven-day summary now respects its exact date range.',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    date: 'November 8, 2026',
    title: 'Capture opportunities from a link',
    summary:
      'Quick Capture gives you a faster starting point when you find an opportunity on another platform. Paste its public posting link, review the suggestions, and decide what to save.',
    spotlight: 'quick-capture',
    accountModeNote:
      'Signed-in account mode can suggest details from supported public employer and ATS pages. LinkedIn links always remain manual: Launchboard does not fetch or scrape LinkedIn. Browser-only mode also keeps links for manual entry.',
    sections: [
      {
        heading: 'Added',
        items: [
          'Quick Capture can suggest posting details from supported public employer and ATS pages. Nothing is saved until you review and confirm it.',
          'LinkedIn links are kept for manual entry. Launchboard does not automatically access or scrape LinkedIn pages.',
          'Opportunity records can include multiple locations, department, team, workplace type, employment type, posted date and a structured compensation range.',
          'Duplicate warnings help you spot an existing opportunity with the same posting link or matching title and company.',
        ],
      },
      {
        heading: 'Improved',
        items: [
          'The review form keeps extracted details editable and lets you continue manually when a page cannot be read.',
          'Older backups and existing opportunities remain compatible with the new optional details.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    date: 'November 7, 2026',
    title: 'Keep every next step moving',
    summary:
      'The Action Center brings opportunity-related tasks into one focused place, while keeping tasks connected to the opportunities they belong to.',
    sections: [
      {
        heading: 'Added',
        items: [
          'Create, edit, complete, reopen and delete tasks linked to an opportunity, with priority and optional due dates.',
          'The Action Center groups work into Overdue, Due today, Upcoming, No due date and Completed.',
          'Dashboard Today’s Focus and the Calendar make it easier to find and open the tasks that need attention.',
        ],
      },
      {
        heading: 'Improved',
        items: [
          'Tasks work in both browser-only and signed-in account modes.',
          'JSON backups preserve task details, and older backups can still be imported.',
        ],
      },
    ],
  },
];
