import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, Copy } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info' | 'copy';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
  copyToClipboard: (text: string, label?: string) => Promise<void>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  const copyToClipboard = useCallback(async (text: string, label?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已复制 ${label ? `[${label}]` : ''}: ${text.length > 32 ? text.substring(0, 32) + '...' : text}`, 'copy');
    } catch {
      // Fallback for older browsers or non-HTTPS
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast(`已复制 ${label ? `[${label}]` : ''}`, 'copy');
    }
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, copyToClipboard }}>
      {children}
      {/* Toast Render Container */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-900/95 backdrop-blur-md border border-cyan-500/30 text-slate-100 shadow-2xl shadow-cyan-950/50 text-sm font-sans transform transition-all duration-300 animate-in fade-in slide-in-from-bottom-3"
          >
            {toast.type === 'copy' && <Copy className="w-4 h-4 text-cyan-400 shrink-0" />}
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
            <span className="font-mono text-xs break-all">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
