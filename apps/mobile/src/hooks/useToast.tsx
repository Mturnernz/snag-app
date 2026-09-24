import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Toast from '../components/Toast';

/** One thing the toast can offer to do — in practice, taking back a tap. */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastContextValue {
  showToast: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const [action, setAction] = useState<ToastAction | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, next?: ToastAction) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(msg);
    setAction(next ?? null);
    setVisible(true);
    // Longer when there is something to press: two seconds is enough to read
    // a sentence and not enough to reach for a button beside it.
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      setAction(null);
    }, next ? 5000 : 2000);
  }, []);

  const press = useCallback(() => {
    if (!action) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisible(false);
    setAction(null);
    action.onPress();
  }, [action]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toast
        message={message}
        visible={visible}
        actionLabel={action?.label}
        onAction={action ? press : undefined}
      />
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
