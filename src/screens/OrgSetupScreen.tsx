import React, { useState } from 'react';
import { signOut } from '../lib/supabase';
import OrgChoiceScreen from './OrgChoiceScreen';
import OrgCreateScreen from './OrgCreateScreen';
import OrgJoinScreen from './OrgJoinScreen';

interface Props {
  userId: string;
  onComplete: () => void;
}

type Mode = 'choose' | 'create' | 'join';

export default function OrgSetupScreen({ userId, onComplete }: Props) {
  const [mode, setMode] = useState<Mode>('choose');

  if (mode === 'create') {
    return <OrgCreateScreen userId={userId} onComplete={onComplete} onBack={() => setMode('choose')} />;
  }

  if (mode === 'join') {
    return <OrgJoinScreen userId={userId} onComplete={onComplete} onBack={() => setMode('choose')} />;
  }

  return (
    <OrgChoiceScreen
      onSelectCreate={() => setMode('create')}
      onSelectJoin={() => setMode('join')}
      onSignOut={() => signOut()}
    />
  );
}
