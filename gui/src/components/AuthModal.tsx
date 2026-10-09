import React, { useState, useEffect } from 'react';
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
  Terminal,
  Mail,
  AlertCircle
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string, user: any, rememberMe: boolean) => void;
}

type AuthStep =
  | 'input_asn'
  | 'password_login'
  | 'select_method'
  | 'verify_email'
  | 'verify_ssh'
  | 'set_password';

interface AuthCheckData {
  asn: number;
  hasPassword: boolean;
  asName: string;
  personName: string;
  primaryEmail: string;
  emailSource: string;
  primarySshKey: string;
  authKeys: string[];
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { copyToClipboard, showToast } = useToast();

  const [step, setStep] = useState<AuthStep>('input_asn');
  const [osType, setOsType] = useState<'windows' | 'unix'>('windows');

  // Step 1: Input ASN
  const [asnInput, setAsnInput] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [authCheckData, setAuthCheckData] = useState<AuthCheckData | null>(null);

  // Step 2: Password Login
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 3: Select Verification Method (Figure 2 layout)
  const [selectedMethod, setSelectedMethod] = useState<'email' | 'ssh'>('email');
  const [showFullSshKey, setShowFullSshKey] = useState(false);

  // Step 4: Email OTP Verification
  const [otpInput, setOtpInput] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(0);

  // Step 5: SSH Challenge Verification
  const [customKeyPath, setCustomKeyPath] = useState('');
  const [challengeData, setChallengeData] = useState<any>(null);
  const [signatureInput, setSignatureInput] = useState('');

  // Step 6: Set New Password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tempAuthResult, setTempAuthResult] = useState<any>(null);

  // Global Loading State
  const [isLoading, setIsLoading] = useState(false);

  // Cooldown countdown effect (30s)
  useEffect(() => {
    if (emailCooldown <= 0) return;
    const interval = setInterval(() => {
      setEmailCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [emailCooldown]);

  if (!isOpen) return null;

  const rawKeyPath = customKeyPath.trim();
  const hasPathSeparator =
    rawKeyPath.includes('/') ||
    rawKeyPath.includes('\\') ||
    rawKeyPath.includes(':') ||
    rawKeyPath.startsWith('~') ||
    rawKeyPath.startsWith('$') ||
    rawKeyPath.startsWith('.');

  const effectiveKeyPath = !rawKeyPath
    ? osType === 'windows'
      ? '$HOME\\.ssh\\id_ed25519'
      : '$HOME/.ssh/id_ed25519'
    : hasPathSeparator
    ? rawKeyPath
    : osType === 'windows'
    ? `$HOME\\.ssh\\${rawKeyPath}`
    : `$HOME/.ssh/${rawKeyPath}`;

  const challengeText = challengeData?.challengeText || challengeData?.challenge || '';
  const namespace = challengeData?.namespace || 'akilab';

  const generatedCommand =
    osType === 'windows'
      ? `'${challengeText}' | ssh-keygen -q -Y sign -n ${namespace} -f "${effectiveKeyPath}"`
      : `printf '%s' '${challengeText}' | ssh-keygen -q -Y sign -n ${namespace} -f "${effectiveKeyPath}"`;

  const handleClose = () => {
    onClose();
    setStep('input_asn');
    setAsnInput('');
    setPasswordInput('');
    setShowPassword(false);
    setAuthCheckData(null);
    setSelectedMethod('email');
    setShowFullSshKey(false);
    setOtpInput('');
    setEmailCooldown(0);
    setSignatureInput('');
    setNewPassword('');
    setConfirmPassword('');
    setTempAuthResult(null);
    setCustomKeyPath('');
  };

  // 1. Stage 1: Input ASN & Authoritatively Query Gateway / WHOIS
  const handleCheckAsn = async () => {
    const raw = asnInput.trim();
    if (!raw) {
      showToast('Please enter your DN42 ASN', 'error');
      return;
    }
    const cleanAsn = raw.replace(/\D/g, '');
    if (!cleanAsn) {
      showToast('Please enter a valid numeric ASN (e.g. 4242423143)', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await ApiClient.checkAuth(cleanAsn);
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'Failed to query DN42 Registry', 'error');
        return;
      }

      const data: AuthCheckData = res.data;
      setAuthCheckData(data);

      // Default verification method preference: Email first if available, else SSH
      if (data.primaryEmail) {
        setSelectedMethod('email');
      } else if (data.primarySshKey || (data.authKeys && data.authKeys.length > 0)) {
        setSelectedMethod('ssh');
      }

      // Hierarchy: if password exists, go directly to password login; otherwise Figure 2 method select
      if (data.hasPassword) {
        setStep('password_login');
      } else {
        setStep('select_method');
      }
    } catch (err: any) {
      showToast(err.message || 'Network error while checking ASN', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Stage 2A: Password Login
  const handlePasswordLogin = async () => {
    if (!authCheckData && !asnInput.trim()) {
      showToast('Please enter ASN', 'error');
      return;
    }
    if (!passwordInput) {
      showToast('Please enter your password', 'error');
      return;
    }

    const asnToLogin = authCheckData?.asn ? String(authCheckData.asn) : asnInput.trim();
    setIsLoading(true);
    try {
      const res = await ApiClient.loginPassword(asnToLogin, passwordInput, rememberMe);
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'Login failed, please check your password', 'error');
        return;
      }

      ApiClient.setToken(res.data.token, rememberMe);
      onSuccess(res.data.token, res.data.user || res.data, rememberMe);
      handleClose();
      showToast(
        res.data.user?.role === 'admin' || res.data.role === 'admin'
          ? `👑 Welcome Admin ${res.data.user?.asn || res.data.asn}`
          : `🎉 Welcome back, AS${res.data.user?.asn || res.data.asn} (${res.data.user?.mnt || res.data.user?.asName || authCheckData?.personName || 'DN42 User'})`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message || 'Login request failed, please try again', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Stage 2B: Figure 2 Action — Initiate Challenge (Email OTP or SSH)
  const handleInitiateChallenge = async () => {
    if (!authCheckData) return;

    if (selectedMethod === 'email') {
      if (!authCheckData.primaryEmail) {
        showToast('No registered email found in WHOIS records for this ASN', 'error');
        return;
      }

      setIsLoading(true);
      try {
        const res = await ApiClient.sendEmailOtp(authCheckData.asn);
        if (!res.success) {
          showToast(res.error?.message || 'Failed to send email verification code', 'error');
          return;
        }

        setEmailCooldown(30);
        setStep('verify_email');
        showToast(`Verification code sent to ${authCheckData.primaryEmail}`, 'success');
      } catch (err: any) {
        showToast(err.message || 'Failed to request email OTP', 'error');
      } finally {
        setIsLoading(false);
      }
    } else {
      // SSH Signature Challenge
      setIsLoading(true);
      try {
        const res = await ApiClient.getChallenge(authCheckData.asn);
        if (!res.success || !res.data) {
          showToast(res.error?.message || 'Failed to fetch cryptographic challenge', 'error');
          return;
        }

        setChallengeData(res.data);
        setStep('verify_ssh');
        showToast(`SSH challenge generated for AS${authCheckData.asn}`, 'success');
      } catch (err: any) {
        showToast(err.message || 'Failed to fetch SSH challenge', 'error');
      } finally {
        setIsLoading(false);
      }
    }
  };

  // 4. Email OTP Resend with 30s Cooldown
  const handleResendEmailOtp = async () => {
    if (!authCheckData || emailCooldown > 0) return;

    setIsLoading(true);
    try {
      const res = await ApiClient.sendEmailOtp(authCheckData.asn);
      if (!res.success) {
        showToast(res.error?.message || 'Failed to resend code', 'error');
        return;
      }
      setEmailCooldown(30);
      showToast(`New code sent to ${authCheckData.primaryEmail}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Resend request failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Verify Email OTP Code
  const handleVerifyEmailOtp = async () => {
    const cleanCode = otpInput.replace(/\D/g, '').slice(0, 6);
    if (!cleanCode || cleanCode.length !== 6) {
      showToast('Please enter the 6-digit verification code', 'error');
      return;
    }
    if (!authCheckData) return;

    setIsLoading(true);
    try {
      const res = await ApiClient.verifyEmailOtp(authCheckData.asn, cleanCode, rememberMe);
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'Email OTP verification failed', 'error');
        return;
      }

      ApiClient.setToken(res.data.token, rememberMe);
      setTempAuthResult(res.data);

      if (authCheckData.hasPassword) {
        onSuccess(res.data.token, res.data.user || res.data, rememberMe);
        handleClose();
        showToast(`🎉 Verified via Email OTP! Welcome AS${authCheckData.asn}`, 'success');
      } else {
        setStep('set_password');
        showToast('🎉 Email verified! You can set an optional password for future fast logins.', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Verification request failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Verify SSH Signature
  const handleVerifySsh = async () => {
    if (!signatureInput.trim()) {
      showToast('Please paste the generated SSH signature', 'error');
      return;
    }
    if (!authCheckData) return;

    setIsLoading(true);
    try {
      const res = await ApiClient.verifySignature(authCheckData.asn, challengeText, signatureInput.trim(), rememberMe);
      if (!res.success || !res.data) {
        showToast(res.error?.message || 'SSH signature verification failed', 'error');
        return;
      }

      ApiClient.setToken(res.data.token, rememberMe);
      setTempAuthResult(res.data);

      if (authCheckData.hasPassword) {
        onSuccess(res.data.token, res.data.user || res.data, rememberMe);
        handleClose();
        showToast(`🎉 Verified via SSH Signature! Welcome AS${authCheckData.asn}`, 'success');
      } else {
        setStep('set_password');
        showToast('🎉 SSH verification succeeded! You can set an optional password for future fast logins.', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Signature verification request failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 7. Save Custom Password & Complete Login
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
        ApiClient.setToken(tempAuthResult.token, rememberMe);
      }
      const res = await ApiClient.setPassword(newPassword);
      if (!res.success) {
        showToast(res.error?.message || 'Failed to update password', 'error');
        return;
      }

      if (tempAuthResult) {
        ApiClient.setToken(tempAuthResult.token, rememberMe);
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
      ApiClient.setToken(tempAuthResult.token, rememberMe);
      onSuccess(tempAuthResult.token, tempAuthResult.user || tempAuthResult, rememberMe);
    }
    handleClose();
    showToast('🎉 Signed in successfully', 'success');
  };

  const truncateSshKey = (key: string) => {
    if (!key) return '(No SSH key)';
    if (key.length <= 48) return key;
    return `${key.slice(0, 45)}...`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-lg p-6 sm:p-7 rounded-2xl border border-white/10 shadow-2xl bg-[#090d16]/95 relative text-slate-100 font-sans">
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer z-20"
        >
          <X className="w-4 h-4" />
        </button>

        {/* ----------------- STEP 1: Enter ASN ----------------- */}
        {step === 'input_asn' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 pr-12">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  DN42 Portal Login &middot; <span className="text-slate-400 font-normal text-xs">登录认证</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Enter your DN42 ASN to continue &middot; <span className="text-slate-500 font-normal text-[11px]">输入您的 DN42 ASN 以继续</span>
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">DN42 ASN or Account</label>
              <input
                type="text"
                placeholder="4242423143 or AS4242423143"
                value={asnInput}
                onChange={(e) => setAsnInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCheckAsn()}
                autoFocus
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
              <span>Remember login for 30 days &middot; 保持登录 30 天</span>
            </label>

            <button
              onClick={handleCheckAsn}
              disabled={isLoading}
              className="btn-primary w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>Continue &middot; 继续</span>
            </button>
          </div>
        )}

        {/* ----------------- STEP 2: Password Login (For Users with Password) ----------------- */}
        {step === 'password_login' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between pr-12">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-300">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {authCheckData?.personName ? `欢迎回来，${authCheckData.personName}` : `AS${authCheckData?.asn || asnInput} 密码登录`}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {authCheckData?.asName || `AS${authCheckData?.asn}`} &middot; Fast Password Login
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-xs font-mono text-cyan-300 shrink-0">
                AS{authCheckData?.asn || asnInput}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Password &middot; 密码</span>
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
                autoFocus
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
                <span>Remember 30 days</span>
              </label>

              <button
                type="button"
                onClick={() => setStep('select_method')}
                className="text-xs text-cyan-400 hover:underline cursor-pointer"
              >
                使用邮箱 / SSH 验证
              </button>
            </div>

            <button
              onClick={handlePasswordLogin}
              disabled={isLoading}
              className="btn-primary w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>Sign In &middot; 登录</span>
            </button>

            <button
              type="button"
              onClick={() => setStep('input_asn')}
              className="w-full text-center py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              更换 ASN 账号
            </button>
          </div>
        )}

        {/* ----------------- STEP 3: Figure 2 Layout (Select Verification Method) ----------------- */}
        {step === 'select_method' && (
          <div className="space-y-5">
            {/* Top Identity Header (Figure 2 Style) */}
            <div className="flex items-start justify-between pr-12">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  你好，{authCheckData?.personName || authCheckData?.asName || `AS${authCheckData?.asn}`}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  登入后，你可以在 AkiLab Portal 的“账户”页面设置密码或修改登入方式。
                </p>
              </div>
              <span className="px-3 py-1 rounded-lg bg-white/10 border border-white/10 text-xs font-mono text-slate-300 shrink-0">
                AS{authCheckData?.asn}
              </span>
            </div>

            {/* Verification Method Options */}
            <div className="space-y-3">
              {/* Option 1: Email Verification */}
              <div
                onClick={() => {
                  if (authCheckData?.primaryEmail) setSelectedMethod('email');
                }}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3.5 ${
                  selectedMethod === 'email'
                    ? 'border-cyan-500/70 bg-cyan-950/25 shadow-sm'
                    : 'border-white/10 bg-slate-900/60 hover:border-white/20'
                } ${!authCheckData?.primaryEmail ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {/* Radio Dot */}
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    selectedMethod === 'email' ? 'border-cyan-400' : 'border-slate-500'
                  }`}
                >
                  {selectedMethod === 'email' && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                </div>

                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                  <Mail className="w-5 h-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">邮箱验证</div>
                  <div className="text-xs font-mono text-slate-400 truncate mt-0.5">
                    {authCheckData?.primaryEmail ? (
                      <>
                        <span>{authCheckData.primaryEmail}</span>
                        {authCheckData.emailSource && (
                          <span className="text-slate-500 ml-1.5 font-sans">({authCheckData.emailSource})</span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-500 font-sans">(WHOIS 中未登记邮箱)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Option 2: SSH Signature */}
              <div
                onClick={() => {
                  if (authCheckData?.primarySshKey || (authCheckData?.authKeys && authCheckData.authKeys.length > 0)) {
                    setSelectedMethod('ssh');
                  }
                }}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                  selectedMethod === 'ssh'
                    ? 'border-cyan-500/70 bg-cyan-950/25 shadow-sm'
                    : 'border-white/10 bg-slate-900/60 hover:border-white/20'
                } ${!authCheckData?.primarySshKey && (!authCheckData?.authKeys || authCheckData.authKeys.length === 0) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {/* Radio Dot */}
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-1 ${
                    selectedMethod === 'ssh' ? 'border-cyan-400' : 'border-slate-500'
                  }`}
                >
                  {selectedMethod === 'ssh' && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                </div>

                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
                  <Terminal className="w-5 h-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">SSH 签名</div>
                    {authCheckData?.primarySshKey && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowFullSshKey(!showFullSshKey);
                        }}
                        className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                      >
                        {showFullSshKey ? '收起密钥' : '显示完整密钥'}
                      </button>
                    )}
                  </div>
                  <div className="text-xs font-mono text-slate-400 mt-1 break-all">
                    {authCheckData?.primarySshKey ? (
                      showFullSshKey ? (
                        authCheckData.primarySshKey
                      ) : (
                        truncateSshKey(authCheckData.primarySshKey)
                      )
                    ) : (
                      <span className="text-slate-500 font-sans">(WHOIS 中未登记 SSH 密钥)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Initiate Challenge Button */}
            <button
              onClick={handleInitiateChallenge}
              disabled={isLoading}
              className="btn-primary w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>发起挑战</span>
            </button>

            {/* Back Button */}
            <button
              type="button"
              onClick={() => {
                if (authCheckData?.hasPassword) {
                  setStep('password_login');
                } else {
                  setStep('input_asn');
                }
              }}
              className="w-full text-center py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              返回
            </button>
          </div>
        )}

        {/* ----------------- STEP 4: Email OTP Verification ----------------- */}
        {step === 'verify_email' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pr-12">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">邮箱验证码 &middot; OTP</h3>
                  <p className="text-xs text-slate-400">已向您的注册邮箱发送 6 位验证码</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-xs font-mono text-cyan-300 shrink-0">
                AS{authCheckData?.asn}
              </span>
            </div>

            {/* Info Banner with Spam Reminder */}
            <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/20 text-xs text-purple-200/90 space-y-1">
              <div>
                验证码已发送至：<span className="font-mono font-semibold text-white">{authCheckData?.primaryEmail}</span>
              </div>
              <div className="text-[11px] text-amber-300/90 flex items-center gap-1.5 pt-0.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>若未收到邮件，请务必检查您的垃圾邮件箱 (Spam / Junk)。</span>
              </div>
            </div>

            {/* OTP 6-digit Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">6 位数字验证码</label>
              <input
                type="text"
                placeholder="123456"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                  setOtpInput(pasted);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyEmailOtp()}
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-center text-lg font-mono tracking-widest focus:border-cyan-400 focus:outline-none"
              />
            </div>

            {/* Cooldown / Resend Action */}
            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <span>未收到邮件？</span>
              <button
                type="button"
                onClick={handleResendEmailOtp}
                disabled={emailCooldown > 0 || isLoading}
                className={`cursor-pointer transition-colors ${
                  emailCooldown > 0
                    ? 'text-slate-500 cursor-not-allowed'
                    : 'text-cyan-400 hover:text-cyan-300 underline'
                }`}
              >
                {emailCooldown > 0 ? `${emailCooldown}s 后可重发` : '重新发送验证码'}
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep('select_method')}
                className="w-1/3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                返回
              </button>
              <button
                type="button"
                onClick={handleVerifyEmailOtp}
                disabled={isLoading || otpInput.replace(/\D/g, '').length !== 6}
                className="btn-primary w-2/3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>验证并登入</span>
              </button>
            </div>
          </div>
        )}

        {/* ----------------- STEP 5: SSH Signature Verification ----------------- */}
        {step === 'verify_ssh' && (
          <div className="space-y-4">
            {/* OS Selector */}
            <div className="flex items-center justify-between pr-12">
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
                onClick={() => setStep('select_method')}
                className="w-1/3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                返回
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

        {/* ----------------- STEP 6: Optional Set Password for First-time Users ----------------- */}
        {step === 'set_password' && (
          <div className="space-y-4">
            <div className="pr-12">
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-xs text-emerald-200/90 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>验证成功！为了下次更快速登入，您可以设置一个密码（可选）。</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Set New Password &middot; 设置新密码</label>
              <input
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Confirm Password &middot; 确认新密码</label>
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
                Skip & Sign In &middot; 跳过
              </button>
              <button
                type="button"
                onClick={handleSavePassword}
                disabled={isLoading}
                className="btn-primary w-1/2 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                <span>Save Password &middot; 保存密码</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
