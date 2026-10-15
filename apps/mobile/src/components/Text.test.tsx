import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '../test/render';
import { Text, resolveFont } from './Text';
import { Fonts, FontFiles } from '../constants/theme';

// A bundled font is one file per weight, and neither platform picks the file
// from `fontWeight`. The shared Text does, and sets the weight back to normal
// so nothing is synthesised on top.

const family = (node: any) => StyleSheet.flatten(node.props.style)?.fontFamily;

describe('the file behind a weight', () => {
  it('is the regular file with no weight, and the semibold file at 600', () => {
    expect(resolveFont({}, null)?.style.fontFamily).toContain(FontFiles.sans400);
    expect(resolveFont({ fontWeight: '600' }, null)?.style.fontFamily).toContain(FontFiles.sans600);
    expect(resolveFont({ fontWeight: '800' }, null)?.style.fontFamily).toContain(FontFiles.sans800);
    expect(resolveFont({ fontWeight: '600' }, null)?.style.fontWeight).toBe('normal');
  });

  it('keeps data in mono', () => {
    expect(resolveFont({ fontFamily: Fonts.mono }, null)?.style.fontFamily).toContain(FontFiles.mono400);
    expect(resolveFont({ fontFamily: Fonts.mono, fontWeight: '600' }, null)?.style.fontFamily)
      .toContain(FontFiles.mono500);
  });

  it('leaves a family it does not know alone', () => {
    expect(resolveFont({ fontFamily: 'Ionicons' }, null)).toBeNull();
  });
});

describe('a Text inside a Text', () => {
  it('inherits its parent when it says nothing about type', () => {
    const r = render(<Text style={{ fontWeight: '700' }}>Due <Text>Saturday</Text></Text>);
    const inner = r.getByText('Saturday');
    expect(family(inner)).toBeUndefined();
  });

  it('takes its own weight in its parent’s family', () => {
    const r = render(
      <Text style={{ fontFamily: Fonts.mono }}>SNAG-0042 <Text style={{ fontWeight: '600' }}>late</Text></Text>,
    );
    expect(family(r.getByText('late'))).toContain(FontFiles.mono500);
  });
});
