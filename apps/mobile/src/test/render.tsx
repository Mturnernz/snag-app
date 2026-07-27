import React from 'react';
import TestRenderer, { type ReactTestInstance } from 'react-test-renderer';

// A thin render helper over react-test-renderer.
//
// @testing-library/react-native would normally provide this, but its releases
// track React Native versions closely and no published version renders cleanly
// against this project's Expo SDK 54 / RN 0.81 / React 19.1 combination — v14
// needs React 19.2, and v13 unmounts the tree mid-render here. The underlying
// renderer works fine, so this wraps it in the few queries the specs need
// rather than pinning a fragile dependency matrix.
//
// Swap this for @testing-library/react-native when a version lines up with the
// SDK; the query names below deliberately mirror its API to keep that cheap.

export interface RenderResult {
  root: ReactTestInstance;
  toJSON: () => unknown;
  unmount: () => void;
  /** Every host <Text> whose rendered content equals `text`. */
  getAllByText: (text: string) => ReactTestInstance[];
  /** The single host <Text> matching `text`; throws if absent or ambiguous. */
  getByText: (text: string) => ReactTestInstance;
  queryByText: (text: string) => ReactTestInstance | null;
  /** Host elements of a given type, e.g. 'View' or 'Text'. */
  getAllByType: (type: string) => ReactTestInstance[];
}

const textContent = (node: ReactTestInstance): string =>
  node.children
    .map((c) => (typeof c === 'string' ? c : textContent(c as ReactTestInstance)))
    .join('');

export function render(element: React.ReactElement): RenderResult {
  let renderer!: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });

  const hostsOfType = (type: string) =>
    renderer.root.findAll((n) => typeof n.type === 'string' && n.type === type, {
      deep: true,
    });

  const getAllByText = (text: string) =>
    hostsOfType('Text').filter((n) => textContent(n) === text);

  return {
    get root() {
      return renderer.root;
    },
    toJSON: () => renderer.toJSON(),
    unmount: () => TestRenderer.act(() => renderer.unmount()),
    getAllByText,
    getByText: (text: string) => {
      const found = getAllByText(text);
      if (found.length === 0) {
        const available = hostsOfType('Text').map(textContent).filter(Boolean);
        throw new Error(
          `No <Text> with content "${text}". Rendered text: ${JSON.stringify(available)}`
        );
      }
      if (found.length > 1) {
        throw new Error(`Found ${found.length} <Text> elements with content "${text}"; expected one.`);
      }
      return found[0];
    },
    queryByText: (text: string) => getAllByText(text)[0] ?? null,
    getAllByType: hostsOfType,
  };
}

/** Collapses RN's array/nested style props into one object. */
export function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([style].flat(Infinity).filter(Boolean) as object[]));
}
