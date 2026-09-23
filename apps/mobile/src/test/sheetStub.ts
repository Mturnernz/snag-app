/**
 * A sheet standing in for itself in a screen test: one line saying whether it
 * is open and, optionally, on what. Screen specs assert the wiring; each sheet
 * has its own spec for what is inside it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Text } from 'react-native';

export function sheetStub(name: string, describe: (props: any) => string | null = () => null) {
  return {
    __esModule: true,
    default: (props: any) => {
      if (!props.visible) return null;
      const what = describe(props);
      return React.createElement(Text, null, `${name} open${what ? `: ${what}` : ''}`);
    },
  };
}
