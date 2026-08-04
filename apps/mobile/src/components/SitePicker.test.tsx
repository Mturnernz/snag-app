import React from 'react';
import TestRenderer from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { render, flattenStyle } from '../test/render';
import SitePicker from './SitePicker';
import { ReportSite } from '../lib/reportSite';

const sites: ReportSite[] = [
  { id: 'a', name: 'NSP' },
  { id: 'b', name: 'Southern Yard' },
];

// The control is the first touchable; the options follow it once open.
const control = (root: ReturnType<typeof render>['root']) =>
  root.findAllByType(TouchableOpacity)[0];

const open = (root: ReturnType<typeof render>['root']) =>
  TestRenderer.act(() => control(root).props.onPress());

describe('SitePicker', () => {
  it('shows the label and the selected site', () => {
    const { getByText } = render(<SitePicker sites={sites} value={sites[0]} onChange={() => {}} />);
    expect(getByText('Site')).toBeTruthy();
    expect(getByText('NSP')).toBeTruthy();
  });

  it('stacks the label above the control by default', () => {
    const { getAllByType } = render(<SitePicker sites={sites} value={sites[0]} onChange={() => {}} />);
    expect(flattenStyle(getAllByType('View')[0].props.style).flexDirection).toBeUndefined();
  });

  it('puts the label on the control\'s own row when inline', () => {
    const { getAllByType } = render(
      <SitePicker sites={sites} value={sites[0]} onChange={() => {}} layout="inline" />
    );
    expect(flattenStyle(getAllByType('View')[0].props.style).flexDirection).toBe('row');
  });

  it('lists every site once open and reports the one chosen', () => {
    const onChange = jest.fn();
    const { root, getAllByText } = render(
      <SitePicker sites={sites} value={sites[0]} onChange={onChange} />
    );

    open(root);
    // The selected site now appears twice: on the control and in the menu.
    expect(getAllByText('NSP')).toHaveLength(2);
    expect(getAllByText('Southern Yard')).toHaveLength(1);

    const southern = root.findAllByType(TouchableOpacity)[2];
    TestRenderer.act(() => southern.props.onPress());
    expect(onChange).toHaveBeenCalledWith(sites[1]);
    // Closed again — one mention of each site, on the control.
    expect(getAllByText('NSP')).toHaveLength(1);
  });
});
