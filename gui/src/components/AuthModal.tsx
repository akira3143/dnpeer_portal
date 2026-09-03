import React, { useState } from 'react';
import { ApiClient } from '../api/client';
import { useToast } from './Toast';
import {
  ShieldCheck,
  Copy,
  X,
  Loader2,
  CheckCircle2,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  Terminal
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string, user: any, rememberMe: boolean) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { copyToClipboard, showToast } = useToast();

  const [authMode, setAuthMode] = useState<'password' | 'ssh'>('password');
  const [step, setStep] = useState<'input_asn' | 'verify_ssh' | 'set_password'>('input_asn');
  const [osType, setOsType] = useState<'windows' | 'unix'>('windows');

  // Inputs
  const [asnInput, setAsnInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // New Password Setup
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tempAuthResult, setTempAuthResult] = useState<any>(null);

  // SSH Custom Key Path
  const [customKeyPath, setCustomKeyPath] = useState('');

  // Loading & Data
  const [isLoading, setIsLoading] = useState(false);
  const [challengeData, setChallengeData] = useState<any>(null);
  const [signatureInput, setSignatureInput] = useState('');

  if (!isOpen) return null;

  const rawKeyPath = customKeyPath.trim();
  const hasPathSeparator = rawKeyPath.includes('/') || rawKeyPath.includes('\\') || rawKeyPath.includes(':') || rawKeyPath.startsWith('~') || rawKeyPath.startsWith('$') || rawKeyPath.startsWith('.');

  const effectiveKeyPath = !rawKeyPath
    ? (osType === 'windows' ? '$HOME\\.ssh\\id_ed25519' : '$HOME/.ssh/id_ed25519')
    : hasPathSeparator
      ? rawKeyPath
      : (osType === 'windows' ? `$HOME\\.ssh\\${rawKeyPath}` : `$HOME/.ssh/${rawKeyPath}`);

  const challengeText = challengeData?.challengeText || challengeData?.challenge || '';

  const generatedCommand = osType === 'windows'
    ? `sc $env:TEMP\\dnp '${challengeText}' -NoNewline; ssh-keygen -q -Y sign -n akilab -f "${effectiveKeyPath}" $env:TEMP\\dnp; gc $env:TEMP\\dnp.sig; ri $env:TEMP\\dnp,$env:TEMP\\dnp.sig -ea 0`
    : `printf '%s' '${challengeText}' > /tmp/dnp && ssh-keygen -q -Y sign -n akilab -f "${effectiveKeyPath}" /tmp/dnp && cat /tmp/dnp.sig && rm -f /tmp/dnp /tmp/dnp.sig`;

  const handleClose = () => {
    onClose();
    setStep('input_asn');
    setSignatureInput('');
    setPasswordInput('');
    setNewPassword('');
    setConfirmPassword('');
    setTempAuthResult(null);
    setCustomKeyPath('');
  };

  // 1. Password Quick Login
  const handlePasswordLogin = async () => {
    const userInput = asnInput.trim();
    if (!userInput) {
      showToast('Please enter a valid ASN number', 'error');
      return;
    }
    if (!passwordInput) {
      showToast('Please enter your password', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await ApiClient.loginPassword(userInput, passwordInput, rememberMe);
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'Login failed, please check your password', 'error');
        return;
      }

      ApiClient.setToken(res.data.token);
      onSuccess(res.data.token, res.data.user || res.data, rememberMe);
      handleClose();
      showToast(
        res.data.user?.role === 'admin' || res.data.role === 'admin'
          ? `👑 Welcome Admin ${res.data.user?.asn || res.data.asn}`
          : `🎉 Welcome back, AS${res.data.user?.asn || res.data.asn} (${res.data.user?.asName || res.data.asName || 'DN42 User'})`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message || 'Login request failed, please try again', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Fetch SSH Challenge from DN42 Registry
  const handleFetchChallenge = async () => {
    const cleanAsn = asnInput.replace(/\D/g, '');
    if (!cleanAsn) {
      showToast('Please enter a valid ASN number', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await ApiClient.getChallenge(cleanAsn);
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'Failed to query DN42 Registry', 'error');
        return;
      }

      setChallengeData(res.data);
      setStep('verify_ssh');
      showToast(`Matched Registry record for AS${res.data.asn || cleanAsn}`, 'success');
    } catch {
      showToast('Network error, please try again', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Verify SSH Signature
  const handleVerifySsh = async () => {
    if (!signatureInput.trim()) {
      showToast('Please paste the generated SSH signature', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const cleanAsn = challengeData?.asn || asnInput.replace(/\D/g, '');
      const res = await ApiClient.verifySignature(cleanAsn, challengeText, signatureInput.trim(), rememberMe);
      
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'SSH signature verification failed', 'error');
        return;
      }

      setTempAuthResult(res.data);
      setStep('set_password');
      showToast('🎉 SSH verification succeeded! You can set or reset your password', 'success');
    } catch {
      showToast('Signature verification request failed, please try again', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Save Custom Password & Complete Login
  const handleSavePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setIsLoading(true);
    try {
      if (tempAuthResult?.token) {
        ApiClient.setToken(tempAuthResult.token);
      }
      const res = await ApiClient.setPassword(newPassword);
      if (!res.success) {
        showToast(res.error?.message || 'Failed to update password', 'error');
        return;
      }

      if (tempAuthResult) {
        ApiClient.setToken(tempAuthResult.token);
        onSuccess(tempAuthResult.token, tempAuthResult.user || tempAuthResult, rememberMe);
      }
      handleClose();
      showToast('🔑 Password saved successfully! Signed in.', 'success');
    } catch {
      showToast('Failed to set password', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkipPassword = () => {
    if (tempAuthResult) {
      ApiClient.setToken(tempAuthResult.token);
      onSuccess(tempAuthResult.token, tempAuthResult.user || tempAuthResult, rememberMe);
    }
    handleClose();
    showToast('🎉 Signed in via SSH signature successfully', 'success');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-lg p-6 sm:p-7 rounded-2xl border border-white/10 shadow-2xl bg-[#090d16]/95 relative text-slate-100 font-sans">
        
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight font-sans">
              DN42 Account Authentication &middot; <span className="text-slate-400 font-normal text-xs">账户验证</span>
            </h3>
            <p className="text-xs text-slate-400 font-sans">
              Cryptographic SSH Verification & Fast Password Login &middot; <span className="text-slate-500 font-normal text-[11px]">SSH 密码学签名与密码快捷登录</span>
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        {step === 'input_asn' && (
          <div className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-xl bg-black/40 border border-white/10 text-xs font-medium">
            <button
              onClick={() => setAuthMode('password')}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                authMode === 'password'
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Password Login &middot; <span className="text-slate-400 font-normal text-[11px]">密码登录</span></span>
            </button>
            <button
              onClick={() => setAuthMode('ssh')}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                authMode === 'ssh'
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>SSH Signature &middot; <span className="text-slate-400 font-normal text-[11px]">SSH 签名</span></span>
            </button>
          </div>
        )}

        {/* ----------------- TAB 1: Password Login ----------------- */}
        {step === 'input_asn' && authMode === 'password' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">DN42 ASN or Account</label>
              <input
                type="text"
                placeholder="4242423143 or admin"
                value={asnInput}
                onChange={(e) => setAsnInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Password</span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-slate-400 hover:text-cyan-300 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded bg-slate-900 border-white/20 text-cyan-400 focus:ring-cyan-500 w-4 h-4 cursor-pointer"
                />
                <span>Remember login for 30 days</span>
              </label>

              <button
                type="button"
                onClick={() => setAuthMode('ssh')}
                className="text-xs text-cyan-400 hover:underline cursor-pointer"
              >
                Forgot / Set Password?
              </button>
            </div>

            <button
              onClick={handlePasswordLogin}
              disabled={isLoading}
              className="btn-primary w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50 mt-2"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>Sign In</span>
            </button>
          </div>
        )}

        {/* ----------------- TAB 2: SSH Step 1: Input ASN ----------------- */}
        {step === 'input_asn' && authMode === 'ssh' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-xs text-cyan-200/90 leading-relaxed">
              Verify ownership of your ASN by signing a cryptographic challenge using the SSH key registered under your DN42 Registry maintainer object.
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Your DN42 ASN</label>
              <input
                type="text"
                placeholder="4242423143"
                value={asnInput}
                onChange={(e) => setAsnInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchChallenge()}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-slate-400 hover:text-slate-200 select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded bg-slate-900 border-white/20 text-cyan-400 focus:ring-cyan-500 w-4 h-4 cursor-pointer"
              />
              <span>Remember login for 30 days</span>
            </label>

            <button
              onClick={handleFetchChallenge}
              disabled={isLoading}
              className="btn-primary w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50 mt-2"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
              <span>Fetch Challenge & Instructions</span>
            </button>
          </div>
        )}

        {/* ----------------- SSH Step 2: Verify Signature ----------------- */}
        {step === 'verify_ssh' && (
          <div className="space-y-4">
            
            {/* OS Selector */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">1. Run Signing Command</span>
              <div className="flex rounded-lg bg-black/40 border border-white/10 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setOsType('windows')}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    osType === 'windows' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'
                  }`}
                >
                  PowerShell (Win)
                </button>
                <button
                  type="button"
                  onClick={() => setOsType('unix')}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    osType === 'unix' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'
                  }`}
                >
                  Linux / macOS
                </button>
              </div>
            </div>

            {/* Code Box with Copy */}
            <div className="relative rounded-xl bg-black/90 border border-white/10 p-3 font-mono text-[11px] text-cyan-200/90 break-all pr-10 leading-relaxed">
              <code>{generatedCommand}</code>
              <button
                type="button"
                onClick={() => copyToClipboard(generatedCommand, 'Command')}
                className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/10 hover:bg-cyan-500/30 text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
                title="Copy Command"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Signature Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>2. Paste Signature Output</span>
                <span className="text-slate-500 font-mono text-[10px]">Starts with -----BEGIN SSH SIGNATURE-----</span>
              </label>
              <textarea
                rows={4}
                placeholder="-----BEGIN SSH SIGNATURE-----&#10;...&#10;-----END SSH SIGNATURE-----"
                value={signatureInput}
                onChange={(e) => setSignatureInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep('input_asn')}
                className="w-1/3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleVerifySsh}
                disabled={isLoading}
                className="btn-primary w-2/3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Verify Signature</span>
              </button>
            </div>

          </div>
        )}

        {/* ----------------- SSH Step 3: Optional Set Password ----------------- */}
        {step === 'set_password' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-xs text-emerald-200/90 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>SSH Ownership Verified! Set an optional password for fast login next time.</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Set New Password</label>
              <input
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Confirm Password</label>
              <input
                type="password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSkipPassword}
                className="w-1/2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Skip & Sign In
              </button>
              <button
                type="button"
                onClick={handleSavePassword}
                disabled={isLoading}
                className="btn-primary w-1/2 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                <span>Save Password</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
