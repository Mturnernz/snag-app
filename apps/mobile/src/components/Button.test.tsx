import React from 'react';
import { render, flattenStyle } from '../test/render';
import Button from './Button';
import { Colors } from '../constants/theme';

// What this pins is the disabled state, which is the one people misread.
//
// A filled button used to be dimmed to 50% when disabled. On a plaster ground
// that turned fern into a pale sage that looks like a button somebody broke
// rather than one that isn't ready yet — and white-on-pale-sage fails contrast
// on the way past. So a disabled filled button goes neutral instead: sunken
// well, muted label, 5.31:1. Loading is deliberately not the same case.

const surfaceOf = (result: ReturnType<typeof render>, label: string) => {
  let node: any = result.getByText(label);
  while (node) {
    if (typeof node.type === 'string' && flattenStyle(node.props?.style).backgroundColor !== undefined) {
      return flattenStyle(node.props.style);
    }
    node = node.parent;
  }
  throw new Error(`No filled surface around "${label}"`);
};

const labelStyle = (result: ReturnType<typeof render>, label: string) =>
  flattenStyle(result.getByText(label).props.style);

describe('Button', () => {
  it('fills with the brand when it can be pressed', () => {
    const result = render(<Button label="Add to the list" onPress={jest.fn()} />);
    expect(surfaceOf(result, 'Add to the list').backgroundColor).toBe(Colors.primary);
    expect(labelStyle(result, 'Add to the list').color).toBe(Colors.white);
  });

  it('goes neutral rather than faded when disabled', () => {
    const result = render(<Button label="Add to the list" onPress={jest.fn()} disabled />);
    const surface = surfaceOf(result, 'Add to the list');
    expect(surface.backgroundColor).toBe(Colors.sunken);
    expect(labelStyle(result, 'Add to the list').color).toBe(Colors.textMuted);
    // Not a washed-out version of the brand.
    expect(surface.backgroundColor).not.toBe(Colors.primary);
  });

  it('keeps its colour while loading, because the spinner is the feedback', () => {
    // Going grey mid-press reads as the action having failed.
    const result = render(<Button label="Saving" onPress={jest.fn()} loading />);
    const filled = result.getAllByType('View').map((n) => flattenStyle(n.props.style));
    expect(filled.some((s) => s.backgroundColor === Colors.primary)).toBe(true);
  });

  it('leaves outline buttons alone — there is no fill to neutralise', () => {
    const result = render(<Button label="Sign out" variant="outline" onPress={jest.fn()} disabled />);
    expect(labelStyle(result, 'Sign out').color).toBe(Colors.textPrimary);
  });
});
