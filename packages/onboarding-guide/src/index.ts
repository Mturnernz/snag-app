/**
 * @snag/onboarding-guide — the customer-facing manual, as data.
 *
 * One source, three surfaces: the mobile Help screen, the portal's /help page,
 * and the generated markdown + PDFs (`npm run guide`). It is structured
 * TypeScript rather than a markdown file for three reasons:
 *
 *  - "Show only the parts relevant to my role" needs machine-readable sections.
 *    Prose can't be filtered.
 *  - `apps/mobile` has no markdown renderer and shouldn't gain one — every
 *    third-party renderer is another native-module-on-web risk (see CLAUDE.md's
 *    Code Style notes). Blocks render as plain Text/View.
 *  - It's how this repo already shares copy between clients:
 *    INVESTIGATION_MODE_OPTIONS, ROLE_LABELS, CHECKLIST_STEP_LABELS and
 *    RESOLVE_GATE_LABELS are all one vocabulary in a package, precisely so the
 *    two clients can't word the same thing differently.
 *
 * The content below builds its tables from those same constants rather than
 * re-typing the strings, so a label change in the app reaches the handout.
 *
 * Deliberately one file, like `packages/supabase-queries`. Splitting the types
 * and the content out would need extensionless relative imports, which the
 * apps' bundlers resolve but plain Node does not — and `scripts/build-
 * onboarding-guide.mjs` imports this module directly, with no build step and no
 * bundler dependency, to emit the markdown and the PDFs.
 */

import {
  CHECKLIST_STEPS,
  CHECKLIST_STEP_LABELS,
  INVESTIGATION_MODE_OPTIONS,
  KIND_LABELS,
  ROLE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
} from '@snag/shared-types';
import type { UserRole } from '@snag/shared-types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GuideBlock =
  /** A paragraph. Plain text — no inline markup to parse on three renderers. */
  | { type: 'para'; text: string }
  /** Ordered — do this, then this. Rendered 1. 2. 3. */
  | { type: 'steps'; items: string[] }
  /** Unordered. Rendered with bullets. */
  | { type: 'bullets'; items: string[] }
  /**
   * Set apart from the flow. `warning` is for the things that surprise people
   * and cost them time — not for danger.
   */
  | { type: 'callout'; tone: 'info' | 'warning'; title: string; text: string }
  /** Wrapped in a horizontally scrollable container on every surface. */
  | { type: 'table'; head: string[]; rows: string[][] };

export interface GuideSection {
  /** Stable: a web anchor, a `?section=` value, and a PDF bookmark. Don't rename. */
  id: string;
  title: string;
  /** One line. Shown under the title while the section is collapsed. */
  summary: string;
  /** Who sees this section in-app. Never empty — see onboardingGuide.test.ts. */
  roles: UserRole[];
  blocks: GuideBlock[];
}

// ─── The guide ───────────────────────────────────────────────────────────────


const ALL = ['worker', 'supervisor', 'officer_admin'] as const;
const STAFF = ['supervisor', 'officer_admin'] as const;
const MANAGER = ['officer_admin'] as const;

export const GUIDE_SECTIONS: GuideSection[] = [
  // ── 1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'what-snag-is',
    title: 'What SNAG is',
    summary: 'Two lanes — everyday niggles and serious incidents — kept deliberately apart.',
    roles: [...ALL],
    blocks: [
      {
        type: 'para',
        text: 'SNAG is where your workplace records the things that are wrong and what was done about them. A worker photographs a problem, it lands with the right person, and the trail of what happened next stays attached to it. Nothing lives in a group chat, and nobody has to chase paperwork to find out what happened.',
      },
      {
        type: 'para',
        text: 'Everything in SNAG runs down one of two lanes, and the difference matters more than anything else in this guide.',
      },
      {
        type: 'table',
        head: ['', 'The niggle lane', 'The serious lane'],
        rows: [
          ['Types', `${KIND_LABELS.fixit}, ${KIND_LABELS.improvement}`, `${KIND_LABELS.hazard}, ${KIND_LABELS.incident}`],
          ['For', 'Broken gear, worn markings, a door that sticks, an idea for doing something better', 'Injuries, near-misses, and health & safety hazards'],
          ['Who handles it', 'Whoever it is assigned to, or the work group queue', 'A nominated lead investigator, overseen by your health & safety owners'],
          ['How it closes', 'Someone fixes it and writes a short resolution note', 'Only once a full investigation is on the record — see “Closing a serious snag”'],
        ],
      },
      {
        type: 'para',
        text: 'They are separate because they fail differently. A niggle that sits open for a week is an annoyance. A serious incident that closes without a witness statement is a gap in your records that shows up years later, when somebody asks what you did about it.',
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'One organisation, two ways in',
        text: 'The phone app and the web portal are the same organisation and the same data — not two systems to keep in step. Which one you use depends on your role and what you are doing. See “The app and the portal”.',
      },
    ],
  },

  // ── 2 ──────────────────────────────────────────────────────────────────────
  {
    id: 'getting-in',
    title: 'Getting in — accounts, joining, and roles',
    summary: 'Create an account, join your workplace, and understand what your role can do.',
    roles: [...ALL],
    blocks: [
      { type: 'para', text: 'Everyone signs in with an email address and a password. Your first screen after signing up asks whether you are setting SNAG up for your workplace or joining one that already exists.' },
      {
        type: 'steps',
        items: [
          'Open the app and choose Create your account. Enter your email, a password, and your full name — that name is how your team sees you on every snag you touch.',
          'On Get started, pick how you are joining: Create organisation (you are setting SNAG up), Join with invite code (you have an 8-character code from your manager), Scan a QR code (the workplace code posted on-site), or Just report an issue (send a one-off report to a public organisation without joining).',
          'If you joined with a code, confirm your name and tap Accept & Join. You are in.',
        ],
      },
      { type: 'para', text: 'There are three roles. SNAG uses these names on screen, so this guide does too:' },
      {
        type: 'table',
        head: ['Role', 'Also called', 'In short'],
        rows: [
          [ROLE_LABELS.worker, 'Worker, crew member', 'Reports snags, comments, votes, and can be assigned work — including leading an investigation.'],
          [ROLE_LABELS.supervisor, 'Supervisor, foreman', 'Everything Crew can do, plus triage: assigning snags, running and closing investigations at the sites they supervise.'],
          [ROLE_LABELS.officer_admin, 'Owner, admin, officer', 'Everything a Site Lead can do across every site, plus setting the organisation up — sites, people, roles, work groups and settings.'],
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Manager is the owner role',
        text: 'If you created the organisation, you are a Manager. Screens marked “Managers only” are yours. Wherever this guide says “owner” or “admin”, it means Manager.',
      },
      {
        type: 'para',
        text: 'Roles are set by a Manager, from Manage → Organisation. A person can be promoted or demoted at any time, and the change takes effect the next time they open the app.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Being a Site Lead means belonging to the site',
        text: 'Making someone a Site Lead at a site also makes them a member of it — they see what the crew standing next to them sees, plus the controls to act on it. You do not need to add them twice.',
      },
      { type: 'para', text: 'Forgotten a password? Use Forgot password? on the sign-in screen. The link is emailed to you and works in any browser, including on a different device from the one you asked from.' },
    ],
  },

  // ── 3 ──────────────────────────────────────────────────────────────────────
  {
    id: 'app-and-portal',
    title: 'The app and the portal',
    summary: 'Which of the two you use, and why crew work happens in the app.',
    roles: [...ALL],
    blocks: [
      {
        type: 'table',
        head: ['', 'The app', 'The portal'],
        rows: [
          ['Address', 'app.snaghq.co.nz', 'www.snaghq.co.nz'],
          ['Who', 'Everyone — Crew, Site Leads, Managers', 'Site Leads and Managers only'],
          ['Best for', 'Reporting from where the problem is, photos, working an investigation', 'Triage at a desk, reading across sites, reports and the document library'],
          ['Install', 'Add to Home Screen from your phone browser — it then opens like any other app', 'Nothing to install; it is a website'],
        ],
      },
      {
        type: 'para',
        text: 'The app is what you put on a phone. Open app.snaghq.co.nz in your phone browser and use “Add to Home Screen” — it gets its own icon and opens full-screen, with no browser bars. There is nothing to download from an app store.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Crew cannot sign in to the portal',
        text: 'This is deliberate, not a fault. If a Crew member is given an investigation to lead, they do all of it in the app — the checklist, witnesses, evidence, and uploading a document. The portal will turn them away and offer them the app instead.',
      },
      {
        type: 'para',
        text: 'Email notifications do not point at either address directly. They point at a link that works out who you are: a Site Lead or Manager is taken into the portal, anyone else is offered the app. One link, right destination.',
      },
      {
        type: 'para',
        text: 'The app also works with no signal. A report you write offline is saved on your phone and sends itself when you are back in range — you do not have to remember to come back to it.',
      },
    ],
  },

  // ── 4 ──────────────────────────────────────────────────────────────────────
  {
    id: 'report-a-snag',
    title: 'Reporting a snag',
    summary: 'The everyday lane — broken gear and better ideas. Under a minute.',
    roles: [...ALL],
    blocks: [
      { type: 'para', text: 'Report a Snag is the middle tab, and it is the screen the app opens on. Most reports take under a minute.' },
      {
        type: 'steps',
        items: [
          'Add a photo. Tap the camera to take one, or pick from your library. You can add several.',
          'Say what is wrong, in the “What\'s wrong?” box. This is the only field you have to fill in. Up to 300 characters — a sentence is fine.',
          `Pick a Type: ${KIND_LABELS.fixit} for something broken, ${KIND_LABELS.improvement} for an idea about doing something better.`,
          'Check the site, if you work across more than one. SNAG offers the site you last reported into, so usually there is nothing to change.',
          'Tap Submit Report.',
        ],
      },
      {
        type: 'para',
        text: 'After you submit, SNAG asks which team should handle it — “Which team should handle this?”. Pick a work group if one fits, or tap Assign to the queue and a Site Lead will route it. If your organisation has not set up work groups, you will not see this step at all.',
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Good descriptions get fixed faster',
        text: 'Say what and where: “Broken fire exit door in the main warehouse” beats “door broken”. The photo shows the problem; the words say where to go and what to bring.',
      },
      {
        type: 'para',
        text: 'If what you are reporting involves an injury, a near-miss, or a genuine health & safety hazard, do not use this form. Use Report a Serious Incident — the button at the bottom of the same screen. The next section covers it.',
      },
    ],
  },

  // ── 5 ──────────────────────────────────────────────────────────────────────
  {
    id: 'report-serious',
    title: 'Reporting a serious incident',
    summary: 'Injuries, near-misses and hazards — and what happens once you press submit.',
    roles: [...ALL],
    blocks: [
      {
        type: 'para',
        text: 'Use this for anything involving injury, a near-miss, or a serious health & safety hazard. It creates a formal record for your organisation. You do not investigate it yourself — reporting it flags it straight to the people whose job that is.',
      },
      {
        type: 'steps',
        items: [
          'Tap Report a Serious Incident on the Report tab.',
          'Check the Site.',
          `Pick a Type: ${KIND_LABELS.hazard} for something dangerous that has not hurt anyone yet, ${KIND_LABELS.incident} for something that has happened.`,
          'Describe what happened, who was involved, and any immediate actions taken. Be factual and be specific — this text is read months later by people who were not there.',
          'Add Evidence: photos of the scene, the equipment, anything that explains how this happened. Take them now, before anything is moved.',
          `Choose a Severity: ${Object.values(SEVERITY_LABELS).join(', ')}.`,
          'Tap Next: Review, read it back, then Submit Incident Report.',
        ],
      },
      {
        type: 'table',
        head: ['Severity', 'Use it when'],
        rows: [
          [SEVERITY_LABELS.minor, 'No injury, or first aid at most, and little potential for worse'],
          [SEVERITY_LABELS.moderate, 'A real hazard or a near-miss that could plausibly have hurt someone'],
          [SEVERITY_LABELS.injury, 'Someone was hurt'],
          [SEVERITY_LABELS.critical, 'Serious harm, or a near-miss that could easily have caused it'],
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'What happens after you submit',
        text: "Your health & safety team is notified and an investigation is opened. Someone is assigned to lead it, and it stays open until the first-response checklist, a witness statement and evidence are recorded — plus either a root cause or your organisation's own investigation document.",
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Reporting is not the emergency response',
        text: 'Make the area safe, get people help, and follow your existing emergency procedure first. SNAG is the record of it, not a substitute for it.',
      },
      {
        type: 'para',
        text: 'If you reported something as an ordinary snag and it turns out to be more serious, you do not have to start again — a Site Lead can escalate it into the serious lane, and it keeps its photos, comments and history.',
      },
    ],
  },

  // ── 6 ──────────────────────────────────────────────────────────────────────
  {
    id: 'snag-list',
    title: 'Your snag list, comments and mentions',
    summary: 'Finding what needs you, and talking to people on a snag.',
    roles: [...ALL],
    blocks: [
      { type: 'para', text: 'The Snags tab is your list. It opens on Relevant to me — the union of everything that might need you: snags assigned to you, snags you raised, snags you have been @mentioned on, and any analysis waiting on you.' },
      { type: 'para', text: 'Tap the filter bar to change what you are looking at:' },
      {
        type: 'bullets',
        items: [
          'Relevant to me — the default, described above.',
          'Assigned to me — only what you own.',
          'All in my sites — everything at the sites you belong to.',
          'Raised by me — your own reports.',
          'Mentioned — snags somebody pulled you into.',
        ],
      },
      {
        type: 'para',
        text: `You can also filter by Status. ${STATUS_LABELS.flagged}, ${STATUS_LABELS.in_progress} and ${STATUS_LABELS.rca_pending} are shown by default; ${STATUS_LABELS.resolved} snags are hidden until you tick them, because closed work is noise when you are looking at what is still open. Your filter choices are remembered between sessions.`,
      },
      {
        type: 'table',
        head: ['Status', 'Means'],
        rows: [
          [STATUS_LABELS.flagged, 'Reported, not yet being worked on'],
          [STATUS_LABELS.in_progress, 'Someone is on it'],
          [STATUS_LABELS.rca_pending, 'A 5 Whys analysis is out with someone and has to come back before this can close'],
          [STATUS_LABELS.resolved, 'Done. The single end state for both lanes — there is no separate "sorted"'],
        ],
      },
      {
        type: 'para',
        text: 'Open any snag to see its photos, its history, and its comments. Add a comment to ask a question or record what you did. Type @ to mention someone — they get a notification, the snag turns up in their Mentions list, and they can see it even if it is at a site they do not normally have access to. Use that deliberately.',
      },
      { type: 'para', text: 'You can also vote a snag up. Votes are a signal about what the crew thinks matters most; they do not change anything by themselves, but they are visible to whoever is deciding what to do first.' },
    ],
  },

  // ── 7 ──────────────────────────────────────────────────────────────────────
  {
    id: 'public-reporting',
    title: 'Public and QR reporting',
    summary: 'Letting visitors, contractors and subbies report without an account.',
    roles: [...STAFF],
    blocks: [
      {
        type: 'para',
        text: 'A site can have a QR code printed and put on a wall. Anyone who scans it — a contractor, a delivery driver, a member of the public — gets a stripped-back report form: a photo, a description, their name if they want to give it, and a “This is a safety hazard” switch. They do not pick internal categories, and they do not need an account.',
      },
      { type: 'steps', items: ['Manage → Sites → the site → Public reporting → Enable Public QR.', 'Print the code and put it where people are.', 'Manage → Organisation → Public Reports → Accept public reports, and choose which site those reports land at. You can also switch this on from the site itself.'] },
      { type: 'para', text: 'Public reports arrive in your list marked as public submissions, so you can tell them apart from your own crew\'s. Filter for them when you want to triage that queue on its own.' },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Regenerating a code invalidates the printed one',
        text: 'Regenerate Code gives you a new join or QR code and immediately stops the old one working. If codes are on walls or in inductions, reprint them the same day.',
      },
      { type: 'para', text: 'If a public reporter is abusing the form, open one of their reports and use Block Reporter.' },
    ],
  },

  // ── 8 ──────────────────────────────────────────────────────────────────────
  {
    id: 'triage',
    title: 'Triage — allocating a serious snag',
    summary: 'The three questions you answer the first time you open a serious snag.',
    roles: [...STAFF],
    blocks: [
      {
        type: 'para',
        text: 'The first time a Site Lead or Manager opens a serious snag that has not been allocated, SNAG puts up a prompt that cannot be dismissed. It asks the three things that constitute triaging it, in one place, so nobody reads a hazard end to end without noticing that nobody has been put on it.',
      },
      {
        type: 'steps',
        items: [
          'How will this be investigated? — the investigation mode. See the table below.',
          'Who is running it? — the lead investigator. This can be anyone, including a Crew member. The investigation is not allocated until somebody is named.',
          'Is this a notifiable event? — does it meet WorkSafe\'s threshold? You may answer “Unsure — flag for follow-up”.',
        ],
      },
      {
        type: 'table',
        head: ['Mode', 'What closes the snag'],
        rows: INVESTIGATION_MODE_OPTIONS.map((o) => [o.title, o.detail]),
      },
      {
        type: 'callout',
        tone: 'warning',
        title: '“Our own process” is a substitution, not a shortcut',
        text: 'Document mode swaps the root cause and corrective actions for your document and a supervisor accepting it. The notifiable decision, the first-response checklist, a witness statement and evidence are still required either way.',
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'You may defer the notifiable question — but only that one',
        text: 'It carries a statutory threshold and a pop-up is no place to guess. Nothing is written if you defer, and the question comes back on the resolve gate: the snag will not close without an answer. The mode and the investigator cannot be deferred — they are why the snag is in front of you.',
      },
      {
        type: 'para',
        text: 'A notifiable event has to be reported to WorkSafe as soon as possible, and the site preserved. If you mark one notifiable, record which PCBU is doing the notifying — on a shared site that is often not you.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'The mode locks once work starts',
        text: 'Once there is a root cause or a corrective action under SNAG-guided mode, or an attached document under document mode, the mode cannot be changed — switching it mid-investigation would let a snag close over work that the other mode never asks about. Only a Manager can override, and the override is recorded as such. Reassigning the investigator is always allowed.',
      },
      { type: 'para', text: 'Afterwards, the owner and the mode are re-decided from the Manage panel on the snag itself, not from triage.' },
    ],
  },

  // ── 9 ──────────────────────────────────────────────────────────────────────
  {
    id: 'investigation',
    title: 'Running an investigation',
    summary: 'The steps on a serious snag, in the order they are worked — and who can do each.',
    roles: [...ALL],
    blocks: [
      {
        type: 'para',
        text: 'A serious snag opens as a list of steps. The card at the top names the one thing to do next, so you never have to work out where you are. Below it, each step shows its own progress. Work them in order where you can — the first two are time-critical.',
      },
      {
        type: 'para',
        text: 'SNAG draws one line through all of this: doing versus directing. Doing the investigation — the checklist, witness statements, evidence, the root cause, uploading the document — is open to the assigned lead investigator whatever their role, plus Site Leads and Managers. Directing it — allocating, accepting or rejecting an analysis, accepting the document, creating corrective actions, starting a debrief — is Site Leads and Managers only.',
      },
      {
        type: 'table',
        head: ['Step', 'What it is', 'Who'],
        rows: [
          ['Notifiable Event', "Does this meet WorkSafe's threshold? If yes, it has to be reported as soon as possible and the site preserved. Record which PCBU is notifying.", 'Investigator, Site Lead, Manager'],
          ['Make safe & preserve scene', `The five first-response steps: ${CHECKLIST_STEPS.map((s) => CHECKLIST_STEP_LABELS[s].toLowerCase()).join(', ')}. All five must be ticked.`, 'Investigator, Site Lead, Manager'],
          ['Witnesses', 'What someone who was there saw, in their words. Their name, their account, and optionally a photo or scan of a signed statement.', 'Investigator, Site Lead, Manager'],
          ['Evidence', 'Photos of the scene, the equipment, and anything that explains how this happened. Caption each one — “what does this show?”', 'Investigator, Site Lead, Manager'],
          ['Root cause', 'What actually caused this — not what went wrong, but why it could. SNAG-guided mode only.', 'Investigator, Site Lead, Manager'],
          ['Corrective Actions', 'The things that will stop it happening again. Each has an owner and a due date, and has to be completed and then verified.', 'Created by Site Lead or Manager; completed by whoever owns them'],
          ['Investigation document', "Your organisation's own completed investigation, uploaded. Document mode only.", 'Attached by the investigator; accepted by a Site Lead or Manager'],
          ['5 Whys analysis', 'A formal root cause analysis, usually delegated. See the next section.', 'Delegated by a Site Lead or Manager; answered by whoever it is given to'],
          ['Debrief', 'Findings, attendees, lessons learned. What you tell the crew afterwards.', 'Site Lead, Manager'],
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Take the evidence first',
        text: 'Photographs of the scene are the one part of an investigation you cannot go back and do later. Capture more than you think you need, before the area is cleared.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Crew investigators use the app',
        text: 'If you are Crew and you have been given an investigation to lead, do all of it in the phone app. The portal does not admit Crew, by design.',
      },
      {
        type: 'para',
        text: 'A corrective action marked done sits as “Marked done — waiting on a supervisor to verify” until somebody other than its owner verifies it. That separation is the point: the person who did the work does not sign off their own work.',
      },
    ],
  },

  // ── 10 ─────────────────────────────────────────────────────────────────────
  {
    id: 'closing-serious',
    title: 'Closing a serious snag',
    summary: 'The resolve gate — the conditions, and the one way to close without meeting them.',
    roles: [...STAFF],
    blocks: [
      {
        type: 'para',
        text: 'A serious snag cannot simply be marked done. It reaches Resolved one of two ways, and there is no third: with every condition below met, or with a Site Lead or Manager\'s written reason why not.',
      },
      { type: 'para', text: 'Four conditions apply whichever mode the investigation is in:' },
      {
        type: 'table',
        head: ['Condition', 'Met when'],
        rows: [
          ['Decide if this is notifiable', "Somebody has answered yes or no. “Unsure” does not count — it is a deferral, not a decision."],
          ['Finish the first-response checklist', 'All five steps ticked'],
          ['Add a witness statement', 'At least one statement recorded'],
          ['Capture evidence', 'At least one evidence item'],
        ],
      },
      { type: 'para', text: 'Then two more, depending on the mode chosen at triage:' },
      {
        type: 'table',
        head: ['Mode', 'The last two conditions'],
        rows: [
          [INVESTIGATION_MODE_OPTIONS[0].title, 'Record the root cause · Close the corrective actions (each one completed and verified)'],
          [INVESTIGATION_MODE_OPTIONS[1].title, 'Attach the investigation document · A supervisor accepts it'],
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Attaching is not accepting',
        text: 'Uploading the document and accepting it are two acts, and both are recorded with who did them. The same person may do both — a Site Lead can sign off their own work, and the record shows that they did. Replacing the document clears the acceptance, because a different document is a different investigation.',
      },
      { type: 'para', text: 'While an analysis is out with someone, the snag sits at RCA Pending and cannot be closed at all — accept it or send it back first.' },
      {
        type: 'para',
        text: 'When work genuinely cannot be finished — a witness has left the company, equipment was scrapped before it could be photographed — use Resolve with a reason. You write why, and SNAG records your name, the date, and exactly which conditions were outstanding at that moment. It is shown on the snag from then on, above the investigation it closed over. It is not a way around the gate; it is a way of being honest in the record about closing over it.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'A resolved serious snag can still owe you an analysis',
        text: 'Resolving does not discharge the 5 Whys. A resolved snag showing under “RCA outstanding” is correct — either complete the analysis or record why one is not needed.',
      },
    ],
  },

  // ── 11 ─────────────────────────────────────────────────────────────────────
  {
    id: 'rca-and-debrief',
    title: '5 Whys and the debrief',
    summary: 'The formal analysis, who it goes to, and what you do with the answer.',
    roles: [...ALL],
    blocks: [
      {
        type: 'para',
        text: 'A 5 Whys analysis asks "why?" repeatedly until you reach something you can actually change. "The operator did not see the pedestrian" is not a root cause. "There is no physical separation between forklift routes and the pedestrian walkway" is.',
      },
      {
        type: 'para',
        text: 'It is usually delegated to whoever was closest to the work — often a Crew member, which is the point. The person who was there knows things the person at the desk does not.',
      },
      {
        type: 'steps',
        items: [
          'A Site Lead or Manager opens the 5 Whys analysis step and chooses who should complete it. That person is emailed a link straight to it.',
          'They answer the whys and submit. The snag sits at RCA Pending while they do.',
          'It comes back to whoever delegated it, who either accepts it or sends it back with a note.',
          'Once accepted, the root cause is on the record and the snag can be closed.',
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'If you have been asked to do one',
        text: 'You will get an email and it will appear in your snag list under Relevant to me. Open the analysis step, answer each why in your own words, and submit. If it comes back with a note, the note says what the reviewer wants more of — pick it up and resubmit.',
      },
      {
        type: 'para',
        text: 'Not every serious snag needs a formal analysis. A Site Lead or Manager can record “No RCA needed” with a written reason — that clears the obligation rather than leaving it outstanding forever. Skipping it silently does not.',
      },
      {
        type: 'para',
        text: 'The debrief is the last step and the one people skip. Record the findings, who attended, and the lessons learned. It is the difference between an investigation that changed something and one that produced a file.',
      },
    ],
  },

  // ── 12 ─────────────────────────────────────────────────────────────────────
  {
    id: 'niggle-triage',
    title: 'Working the niggle lane',
    summary: 'Assigning, resolving and merging everyday snags.',
    roles: [...STAFF],
    blocks: [
      { type: 'para', text: 'Open a snag and use the Manage panel. From there you can:' },
      {
        type: 'bullets',
        items: [
          'Change status — move it to In Progress when somebody starts, Resolved when it is done.',
          'Assign to person — give it to a named owner. They are emailed.',
          'Assign to work group — put it in a team\'s queue instead of a person\'s.',
          'Set severity — if the reporter did not, or got it wrong.',
          'Escalate it into the serious lane — if it turns out to be a hazard. Site Leads and Managers at the site are notified.',
        ],
      },
      { type: 'para', text: 'Resolving a niggle needs a resolution note. It is one line and it matters: the reporter is emailed it, and it is what someone reads in a year when the same thing breaks again.' },
      {
        type: 'para',
        text: 'When the same problem is reported several times, select them in the list and use Merge Snags. You give the combined snag a description, and the duplicates become children of it — resolving the parent resolves them, and everybody who reported it is told.',
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Merging never closes a serious snag for you',
        text: 'If a hazard or incident ends up merged under an ordinary snag, it keeps its own status and its own resolve gate. Closing the parent will not close it, and it goes on counting as an open investigation until someone runs one. That is deliberate.',
      },
      {
        type: 'para',
        text: 'Use the “Unassigned in my sites” and “Unassigned in my work groups” filters as your triage queue — they show what nobody has picked up yet.',
      },
    ],
  },

  // ── 13 ─────────────────────────────────────────────────────────────────────
  {
    id: 'documents',
    title: 'The document library',
    summary: 'Your organisation-wide register of policies, procedures and completed investigations.',
    roles: [...ALL],
    blocks: [
      { type: 'para', text: 'The document library is org-wide, separate from the evidence attached to any one snag. It is where your policies, safe work procedures, inductions and completed investigation documents live.' },
      {
        type: 'table',
        head: ['Action', 'Who'],
        rows: [
          ['Read and download', 'Everyone in the organisation'],
          ['Upload', 'Everyone in the organisation'],
          ['Delete', 'Site Leads and Managers'],
        ],
      },
      { type: 'para', text: 'Crew can upload because the person running a document-mode investigation has to be able to file the completed document, and because the policies kept here are the ones crew are expected to follow.' },
      { type: 'para', text: 'Find it at Profile → Documents in the app, or Documents in the portal. You can tag each file with a category.' },
      {
        type: 'callout',
        tone: 'info',
        title: 'Investigation documents go here too',
        text: 'They are filed in the shared library rather than hidden on the snag, so the person who needs one in two years — who was not on the snag — can actually find it.',
      },
    ],
  },

  // ── 14 ─────────────────────────────────────────────────────────────────────
  {
    id: 'portal',
    title: 'The portal',
    summary: 'Dashboard, snags, reports and documents at a desk.',
    roles: [...STAFF],
    blocks: [
      { type: 'para', text: 'Sign in at www.snaghq.co.nz with the same account you use in the app. There are four pages:' },
      {
        type: 'table',
        head: ['Page', 'What it is for'],
        rows: [
          ['Dashboard', 'Outstanding work at a glance, broken down by site: open investigations, unassigned snags, RCA outstanding, overdue actions.'],
          ['Snags', 'Every snag you can see, filterable, with bulk merge and a "Ready to resolve" view of what is only waiting on you.'],
          ['Reports', 'Counts by status, kind and severity, and a 90-day trend of snags reported per week.'],
          ['Documents', 'The same document library as the app.'],
        ],
      },
      {
        type: 'para',
        text: 'The dashboard is the page to open on a Monday. The four counts are the ones that tell you whether anything is being quietly dropped — particularly “Unassigned”, which means a snag nobody has picked up, and “Overdue actions”, which means a corrective action past its due date.',
      },
      { type: 'para', text: 'The app has the same figures on the Manager tab, plus tiles for sites with no site lead and sites with no default owner. The portal is better for reading across sites; the app is better for acting on one.' },
      { type: 'para', text: 'The portal works on a phone too — the sidebar collapses to a menu — but reporting is still faster in the app.' },
    ],
  },

  // ── 15 ─────────────────────────────────────────────────────────────────────
  {
    id: 'setup',
    title: 'Day one — setting up your organisation',
    summary: 'The checklist for the Manager standing SNAG up for the first time.',
    roles: [...MANAGER],
    blocks: [
      { type: 'para', text: 'Work through this in order. It takes about half an hour, and it is the difference between a rollout that sticks and one where reports pile up unassigned.' },
      {
        type: 'steps',
        items: [
          'Create the organisation and name it. Get started → Create organisation. The name is how your workplace appears to everyone who joins, so use the name people would recognise. You are automatically its first Manager.',
          'Add your sites. Manage → Sites → Add a site. Add every physical location you want reports separated by. If you have one location, add one site — do not skip this, because reports need somewhere to land.',
          'Invite your team. Manage → Organisation → Invite a team member. Enter their email, choose their role, and optionally assign them to a site. For a large crew, share the 8-character join code or the Scan to Join QR code instead — faster than typing 40 email addresses.',
          'Appoint Site Leads. Manage → Sites → the site → People, and set the right people to Site Lead. Every site needs at least one, or nobody can triage what gets reported there.',
          'Set a default owner per site. Manage → Sites → the site → People → Owner. This is who unassigned snags at that site fall to. Without one, reports sit in a queue nobody feels responsible for.',
          'Nominate your serious incident owners. Manage → Organisation → Serious incident owners. These are the people emailed the moment a hazard or an incident is reported — your health & safety team. You are one by default because you created the organisation; add the people who should actually get that call.',
          'Set up work groups, if you use them. Manage → Teams → Add a work group. These are the teams that snags get queued to — Maintenance, Electrical, Cleaning. You can scope a group to one site or leave it across all of them. Skip this if a single queue suits you; you can add them later.',
          'Turn on public reporting, if you want it. Manage → Organisation → Public Reports, then Manage → Sites → the site → Public reporting, per site. Print the codes. See “Public and QR reporting”.',
          'Check your work. Open the Manager tab. The tiles for “Sites with no site lead” and “Sites with no default owner” should both be empty. If they are not, go back to steps 4 and 5.',
        ],
      },
      {
        type: 'callout',
        tone: 'warning',
        title: 'Serious incident owners are not optional',
        text: 'They are who the app tells reporters it has notified. There is always at least one — SNAG will not let you remove the last — but the default is whoever created the organisation, which may well not be the right person. Only Site Leads and Managers can be nominated, because owning a serious incident means running the investigation.',
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Free for single-site teams',
        text: 'SNAG is priced per organisation, not per seat — adding people never costs more. See the pricing page if you are growing past one site.',
      },
    ],
  },

  // ── 16 ─────────────────────────────────────────────────────────────────────
  {
    id: 'notifications',
    title: 'Notifications — what lands in whose inbox',
    summary: 'The emails SNAG sends, and who gets each one.',
    roles: [...ALL],
    blocks: [
      {
        type: 'table',
        head: ['When', 'Who is emailed'],
        rows: [
          ['A hazard or incident is reported', 'Your nominated serious incident owners'],
          ['A snag is assigned to someone', 'The new owner — and if it is serious, the mail explains how the investigation is being run'],
          ['A niggle is escalated to the serious lane', 'Site Leads and Managers at that site'],
          ['A snag is resolved', 'The person who reported it, with the resolution note'],
          ['A 5 Whys analysis is delegated', 'The person it was given to'],
          ['An analysis is submitted', 'Whoever delegated it'],
          ['An analysis is sent back', 'The person who wrote it, with the reviewer\'s note'],
          ['Corrective actions go overdue', 'A digest to the people responsible'],
          ['You are @mentioned in a comment', 'You'],
        ],
      },
      { type: 'para', text: 'Every link in those emails goes to the same place and works out where to send you: into the portal if you are a Site Lead or Manager, or to the app otherwise. If you are signed out, you sign in and land on the snag rather than the home screen.' },
      {
        type: 'callout',
        tone: 'info',
        title: 'Check your spam folder on day one',
        text: 'The first email SNAG sends anyone is often the one that gets filtered. Tell your team to look for it and mark it as not spam during onboarding — it saves a fortnight of "I never got told".',
      },
    ],
  },

  // ── 17 ─────────────────────────────────────────────────────────────────────
  {
    id: 'records',
    title: 'Records and retention',
    summary: 'What SNAG keeps, for how long, and why.',
    roles: [...ALL],
    blocks: [
      {
        type: 'para',
        text: 'Health & safety records (hazards, incidents, and anything flagged notifiable) are kept in full — this is what NZ\'s Health and Safety at Work Act requires. Ordinary, resolved everyday snags have their description and photos minimised after a few years to limit how long personal detail is kept, in line with the Privacy Act. This is general guidance, not legal advice.',
      },
      {
        type: 'para',
        text: 'Practically, this means the serious lane is your compliance record and the niggle lane is your maintenance log. That is another reason the two lanes are separate, and another reason to report a hazard as a hazard rather than as a broken thing.',
      },
      { type: 'para', text: 'Photos and evidence are stored privately and scoped to your organisation. Nobody outside it can reach them, and within it, access follows the sites people belong to.' },
      { type: 'para', text: 'Every material action on a snag is recorded with who did it and when — assignments, status changes, acceptances, overrides and early closures. You do not have to maintain that separately.' },
    ],
  },

  // ── 18 ─────────────────────────────────────────────────────────────────────
  {
    id: 'training-your-crew',
    title: 'Training your crew',
    summary: 'A 15-minute toolbox talk that gets people reporting.',
    roles: [...STAFF],
    blocks: [
      { type: 'para', text: 'Run this at a toolbox meeting with everybody\'s phone out. Fifteen minutes, and people leave having actually reported something.' },
      {
        type: 'steps',
        items: [
          'Get everyone in (5 min). Put the join QR code on the wall or share the 8-character code. Everyone scans, enters their name, and is in. Watch for people who do not receive the email — sort them out on the spot.',
          'Add to Home Screen (2 min). Walk them through it on one phone while everyone follows. If they leave it in a browser tab they will not use it.',
          'Report something real (3 min). Have each person report a genuine niggle they can see from where they are standing. Photo, one sentence, submit. That is the whole habit.',
          'Show the difference (3 min). Point at something that would be a hazard and show the Report a Serious Incident button. Say plainly: injury, near-miss, or real danger goes down that path, and it goes straight to the health & safety team.',
          'Show the list (2 min). Open Snags, show Relevant to me, and show a resolved snag with its resolution note — so people see that reports actually get answered.',
        ],
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'The message that makes it work',
        text: '"If you can see it, report it — it takes a minute and somebody will get back to you." Reporting rates follow whether people believe the second half of that sentence, so make sure resolution notes actually get written in the first fortnight.',
      },
      { type: 'para', text: 'Anyone can replay the app\'s own four-slide overview at any time from Profile → Replay tutorial, and this guide is always at Profile → Help & guide.' },
      { type: 'para', text: 'Print the role handouts and leave them in the crib room — there is one each for Crew, Site Leads and Managers.' },
    ],
  },
];

// ─── Metadata and selectors ──────────────────────────────────────────────────

/**
 * Bumped whenever the content changes materially. Stamped into the generated
 * markdown and the PDF footer so a printed copy on a noticeboard can be dated
 * against the app someone is holding.
 */
export const GUIDE_VERSION = '1.0';

export const GUIDE_TITLE = 'SNAG — Getting started';

/** Served from `apps/web/public/`, so this is a path on the portal host. */
export const GUIDE_PDF_PATH = '/snag-onboarding-guide.pdf';

/** Per-role handouts, generated by the same script. What a Site Lead prints. */
export const GUIDE_PDF_PATH_BY_ROLE: Record<UserRole, string> = {
  worker: '/snag-guide-crew.pdf',
  supervisor: '/snag-guide-site-lead.pdf',
  officer_admin: '/snag-guide-manager.pdf',
};

/**
 * The guide as one role sees it.
 *
 * Filtering is deliberately by section rather than by block: a section a role
 * can't act on is hidden outright, so nobody is reading instructions for a
 * button they don't have. Sections a role only partly participates in (the
 * 5 Whys, usually delegated to a worker) say so in their own copy instead of
 * being split in two.
 */
export function sectionsForRole(role: UserRole): GuideSection[] {
  return GUIDE_SECTIONS.filter((s) => s.roles.includes(role));
}

/** A section by id — what `?section=` and a deep link resolve through. */
export function guideSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.id === id);
}
