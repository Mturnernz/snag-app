import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Toast from '../components/Toast';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(msg);
    setVisible(true);
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast message={message} visible={visible} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
