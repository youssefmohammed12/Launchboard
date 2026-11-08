import type { Opportunity } from '../types/opportunity';
import { addDays } from '../utils/dates';

// Deadlines are relative to today so the demo always looks current.
export function seedOpportunities(): Opportunity[] {
  const base = () => ({
    priority: 'Medium' as const,
    tags: [] as string[],
    url: '',
    followUpDate: '',
    activities: [] as Opportunity['activities'],
    interviews: [] as Opportunity['interviews'],
    contacts: [] as Opportunity['contacts'],
    materials: [] as Opportunity['materials'],
    tasks: [] as Opportunity['tasks'],
    locations: [] as string[],
    department: '',
    team: '',
    workplaceType: '' as const,
    employmentType: '',
    postedDate: '',
    compensationDetails: null,
    compensation: '',
    description: '',
    notes: '',
    isDemo: true,
  });
  return [
    { ...base(), id: 'demo-1', title: 'Frontend Intern', company: 'Northwind Labs', type: 'Internship', status: 'Applied', deadline: addDays(3), compensation: '$2,000 / month', description: 'Summer internship on the design systems team.' },
    { ...base(), id: 'demo-2', title: 'Junior React Developer', company: 'Brightpath', type: 'Full-time', status: 'Interview', deadline: addDays(0), notes: 'Technical interview on Thursday.' },
    { ...base(), id: 'demo-3', title: 'Landing Page Redesign', company: 'Olive & Co.', type: 'Freelance', status: 'Saved', deadline: addDays(-2), compensation: '$900 fixed' },
    { ...base(), id: 'demo-4', title: 'Web Developer', company: 'Harbor Studio', type: 'Part-time', status: 'Offer', deadline: addDays(10) },
    { ...base(), id: 'demo-5', title: 'QA Intern', company: 'Pinecone Systems', type: 'Internship', status: 'Rejected', deadline: addDays(-7) },
    { ...base(), id: 'demo-6', title: 'Portfolio Site for Photographer', company: 'Mara Chen', type: 'Freelance', status: 'Saved', deadline: addDays(14) },
  ];
}
