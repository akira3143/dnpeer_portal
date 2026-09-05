/**
 * Brand Logo Selector
 * Pure Cryptographic Random (window.crypto) + 3-Streak Guaranteed Pity (保底机制)
 * 
 * Rules:
 * 1. Default: Independent uniform random selection among all available logos (1/3 each).
 * 2. Pity Rule: If the exact same logo has appeared 3 times in a row, the 4th pick
 *    is guaranteed to be different.
 */
import logo1 from '../assets/logos/logo_1.png';
import logo2 from '../assets/logos/logo_2.png';
import logo3 from '../assets/logos/logo_3.png';

export const BRAND_LOGOS = [
  logo1,
  logo2,
  logo3,
];

const MAX_CONSECUTIVE_STREAK = 3;

function getPityProtectedCryptoRandomLogo(): string {
  if (typeof window === 'undefined') return BRAND_LOGOS[0];

  const lastIndexStr = sessionStorage.getItem('akilab_last_logo_index');
  const streakCountStr = sessionStorage.getItem('akilab_logo_streak_count');

  const lastIndex = lastIndexStr !== null ? parseInt(lastIndexStr, 10) : -1;
  const currentStreak = streakCountStr !== null ? parseInt(streakCountStr, 10) : 0;

  // Determine candidate pool
  let candidates: number[];
  let mustSwitch = false;

  if (lastIndex >= 0 && currentStreak >= MAX_CONSECUTIVE_STREAK) {
    // Guaranteed pity triggered: must pick a different logo
    candidates = BRAND_LOGOS.map((_, i) => i).filter((i) => i !== lastIndex);
    mustSwitch = true;
  } else {
    // Standard pure random across all candidates
    candidates = BRAND_LOGOS.map((_, i) => i);
  }

  // Cryptographic high-entropy random pick
  let chosenIndex: number;
  if (window.crypto && window.crypto.getRandomValues) {
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    chosenIndex = candidates[randomBuffer[0] % candidates.length];
  } else {
    chosenIndex = candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Update streak counter
  let newStreak: number;
  if (chosenIndex === lastIndex && !mustSwitch) {
    newStreak = currentStreak + 1;
  } else {
    newStreak = 1;
  }

  sessionStorage.setItem('akilab_last_logo_index', String(chosenIndex));
  sessionStorage.setItem('akilab_logo_streak_count', String(newStreak));

  return BRAND_LOGOS[chosenIndex];
}

export const CURRENT_BRAND_LOGO = getPityProtectedCryptoRandomLogo();

// Dynamically sync browser tab favicon to match the chosen logo
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    let favicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.type = 'image/png';
    favicon.href = CURRENT_BRAND_LOGO;
  } catch {}
}
