import React, { useState } from 'react';
import { signOut } from '../lib/supabase';
import { PendingJoin } from '../lib/pendingIntent';
import OrgChoiceScreen from './OrgChoiceScreen';
import OrgCreateScreen from './OrgCreateScreen';
import OrgJoinScreen from './OrgJoinScreen';
import ScanJoinCodeScreen from './ScanJoinCodeScreen';

interface Props {
  userId: string;
  onComplete: () => void;
  onPublicReporter: () => void;
  /** Intent captured on the login screen before the account existed. */
  initialMode?: 'create';
  pendingJoin?: PendingJoin | null;
  onClearPending?: () => void;
}

type Mode = 'choose' | 'create' | 'join' | 'scan' | 'pendingJoin';

export default function OrgSetupScreen({
  userId, onComplete, onPublicReporter, initialMode, pendingJoin, onClearPending,
}: Props) {
  const [mode, setMode] = useState<Mode>(
    pendingJoin ? 'pendingJoin' : initialMode ?? 'choose'
  );

  function backToChoice() {
    onClearPending?.();
    setMode('choose');
  }

  // Resume a QR scan made on the login page: skip the camera, go straight to
  // the "Join {org} — your name" step.
  if (mode === 'pendingJoin' && pendingJoin) {
    return (
      <ScanJoinCodeScreen
        initialCode={pendingJoin.code}
        onComplete={() => { onClearPending?.(); onComplete(); }}
        onBack={backToChoice}
      />
    );
  }

  if (mode === 'create') {
    return (
      <OrgCreateScreen
        userId={userId}
        onComplete={() => { onClearPending?.(); onComplete(); }}
        onBack={backToChoice}
      />
    );
  }

  if (mode === 'join') {
    return <OrgJoinScreen userId={userId} onComplete={onComplete} onBack={() => setMode('choose')} />;
  }

  if (mode === 'scan') {
    return <ScanJoinCodeScreen onComplete={onComplete} onBack={() => setMode('choose')} />;
  }

  return (
    <OrgChoiceScreen
      onSelectCreate={() => setMode('create')}
      onSelectJoin={() => setMode('join')}
      onSelectScan={() => setMode('scan')}
      onSelectPublic={onPublicReporter}
      onSignOut={() => signOut()}
    />
  );
}
