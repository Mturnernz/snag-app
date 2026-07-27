import React from 'react';
import { render, flattenStyle } from '../test/render';
import { Text } from 'react-native';
import { SEVERITY_LABELS, STATUS_LABELS, type SnagSeverity, type SnagStatus } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';
import PriorityBadge from './PriorityBadge';
import StatusBadge from './StatusBadge';

// Badges are how a supervisor reads a list at a glance, and their colour rules
// are load-bearing design decisions recorded in CLAUDE.md rather than
// incidental styling. These specs pin the rules, not the exact hex values —
// they read the same tokens the components do, so retuning a token in theme.ts
// stays a one-file change.

describe('Badge', () => {
  it('renders a tinted pill with the label in the given colour for the solid variant', () => {
    const { getByText } = render(<Badge label="Flagged" color="#B91C1C" bg="#FEE2E2" variant="solid" />);

    const label = getByText('Flagged');
    expect(flattenStyle(label.props.style).color).toBe('#B91C1C');
  });

  it('defaults to the solid variant', () => {
    const { getByText } = render(<Badge label="Default" color="#111827" bg="#F3F4F6" />);
    expect(flattenStyle(getByText('Default').props.style).color).toBe('#111827');
  });

  it('renders the dot variant with a neutral label so it does not compete with status pills', () => {
    const { getByText } = render(<Badge label="Low" color={Colors.priority.low} variant="dot" />);

    // The colour moves to the dot; the text stays neutral. That contrast is the
    // whole point of the variant.
    const label = getByText('Low');
    expect(flattenStyle(label.props.style).color).toBe(Colors.textSecondary);
  });
});

describe('StatusBadge', () => {
  const statuses: SnagStatus[] = ['flagged', 'in_progress', 'resolved', 'rca_pending'];

  it.each(statuses)('renders the human label for %s', (status) => {
    const { getByText } = render(<StatusBadge status={status} />);
    expect(getByText(STATUS_LABELS[status])).toBeTruthy();
  });

  it('gives every status a distinct colour', () => {
    // Two statuses sharing a colour would make the list unreadable at a glance.
    const colours = statuses.map((status) => {
      const { getByText, unmount } = render(<StatusBadge status={status} />);
      const colour = flattenStyle(getByText(STATUS_LABELS[status]).props.style).color;
      unmount();
      return colour;
    });

    expect(new Set(colours).size).toBe(statuses.length);
  });

  it('renders every status as a solid pill, never a bare dot', () => {
    for (const status of statuses) {
      const { getByText, unmount } = render(<StatusBadge status={status} />);
      const colour = flattenStyle(getByText(STATUS_LABELS[status]).props.style).color;
      expect(colour).not.toBe(Colors.textSecondary);
      unmount();
    }
  });
});

describe('PriorityBadge', () => {
  it('renders nothing when there is no severity', () => {
    // Niggles carry no severity — the badge must vanish rather than render an
    // empty pill or crash on a missing label lookup.
    const { toJSON } = render(<PriorityBadge severity={null} />);
    expect(toJSON()).toBeNull();
  });

  it.each(['minor', 'moderate', 'injury', 'critical'] as SnagSeverity[])(
    'renders the human label for %s',
    (severity) => {
      const { getByText } = render(<PriorityBadge severity={severity} />);
      expect(getByText(SEVERITY_LABELS[severity])).toBeTruthy();
    }
  );

  it('gives critical the alert colour', () => {
    const { getByText } = render(<PriorityBadge severity="critical" />);
    const colour = flattenStyle(getByText(SEVERITY_LABELS.critical).props.style).color;
    expect(colour).toBe(Colors.priority.high);
  });

  it('renders minor and moderate as neutral dots, not alert pills', () => {
    // CLAUDE.md: only the top severity carries an alert colour, so low-signal
    // values cannot be confused with a status badge.
    for (const severity of ['minor', 'moderate'] as SnagSeverity[]) {
      const { getByText, unmount } = render(<PriorityBadge severity={severity} />);
      const colour = flattenStyle(getByText(SEVERITY_LABELS[severity]).props.style).color;

      expect(colour).toBe(Colors.textSecondary);
      expect(colour).not.toBe(Colors.priority.high);
      unmount();
    }
  });

  it('escalates colour monotonically from moderate to critical', () => {
    // moderate is a neutral dot; injury and critical are solid and distinct.
    const read = (severity: SnagSeverity) => {
      const { getByText, unmount } = render(<PriorityBadge severity={severity} />);
      const colour = flattenStyle(getByText(SEVERITY_LABELS[severity]).props.style).color;
      unmount();
      return colour;
    };

    const moderate = read('moderate');
    const injury = read('injury');
    const critical = read('critical');

    expect(moderate).toBe(Colors.textSecondary);
    expect(injury).not.toBe(moderate);
    expect(critical).not.toBe(injury);
  });
});

describe('theme tokens', () => {
  it('exposes every status colour the badge maps', () => {
    // A missing token would render an undefined colour rather than throw, so
    // assert presence directly.
    for (const key of ['flagged', 'inProgress', 'resolved', 'rcaPending'] as const) {
      expect(Colors.status[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(Colors.status[`${key}Bg`]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps the serious-lane identity colour distinct from the primary accent', () => {
    expect(Colors.serious).not.toBe(Colors.primary);
  });
});

// Sanity check that the renderer itself is wired up, so a failure above is a
// real assertion failure rather than a broken preset.
describe('test environment', () => {
  it('renders react-native primitives', () => {
    const { getByText } = render(<Text>hello</Text>);
    expect(getByText('hello')).toBeTruthy();
  });
});
