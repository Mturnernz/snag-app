// Single source of truth for names/links used across the site. Domains are
// placeholders until registered — change them here only.

export const SITE = {
  /** Product brand */
  name: 'SNAG',
  tagline: 'Spot it. Snag it. Sorted.',
  description:
    'SNAG is health & safety and issue reporting software for New Zealand and Australian workplaces. Workers photograph and report problems in seconds; supervisors triage, investigate and resolve them — with a full audit trail for serious incidents.',

  /** Master brand */
  company: 'Docunation',
  companyDescription:
    'Docunation helps small businesses own their processes — handover documentation, process mapping, on-call support, and low-cost custom apps.',

  /** Placeholder contact — swap when real inboxes exist */
  contactEmail: 'hello@docunation.example',

  /** Region focus, used in copy and structured data */
  regions: ['New Zealand', 'Australia'],
} as const;

/** Feature flags for third-party scripts. All off until accounts exist. */
export const ANALYTICS = {
  plausibleDomain: null as string | null, // e.g. 'getsnag.co.nz'
  metaPixelId: null as string | null,
  linkedInPartnerId: null as string | null,
};
