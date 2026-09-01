import React from 'react';

interface CountryFlagProps {
  flag?: string;
  country?: string;
  code?: string;
  city?: string;
  className?: string;
}

/**
 * 提取 2 位 ISO 国家代码 (小写)
 */
export function extractIsoCountryCode(
  flag: string = '',
  code: string = '',
  country: string = '',
  city: string = ''
): string | null {
  // 1. 尝试从 flag 提取
  if (flag) {
    const trimmed = flag.trim();
    // 纯 2 位字母 (例如 "JP", "US", "hk")
    if (/^[A-Za-z]{2}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    // Emoji 区域指示符提取 (0x1F1E6 ~ 0x1F1FF)
    const codePoints = Array.from(trimmed)
      .map((c) => c.codePointAt(0) || 0)
      .filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff);
    if (codePoints.length >= 2) {
      const c1 = String.fromCharCode(codePoints[0] - 0x1f1e6 + 65);
      const c2 = String.fromCharCode(codePoints[1] - 0x1f1e6 + 65);
      return (c1 + c2).toLowerCase();
    }
  }

  // 2. 尝试从节点代号前缀提取 (例如 "JP-7" -> "jp", "HK-1" -> "hk", "US-LA1" -> "us", "UK-LON" -> "gb", "DE-1" -> "de")
  if (code) {
    const cleanCode = code.trim().toLowerCase();
    if (cleanCode.startsWith('uk-') || cleanCode.startsWith('uk_') || cleanCode.startsWith('uk')) {
      return 'gb';
    }
    const prefixMatch = cleanCode.match(/^[a-z]{2}/);
    if (prefixMatch) {
      return prefixMatch[0];
    }
  }

  // 3. 从国家全名匹配
  if (country) {
    const c = country.trim().toLowerCase();
    const map: Record<string, string> = {
      japan: 'jp',
      'hong kong': 'hk',
      'hong kong sar': 'hk',
      'united states': 'us',
      'united states of america': 'us',
      usa: 'us',
      germany: 'de',
      singapore: 'sg',
      'united kingdom': 'gb',
      uk: 'gb',
      britain: 'gb',
      france: 'fr',
      netherlands: 'nl',
      australia: 'au',
      canada: 'ca',
      china: 'cn',
      taiwan: 'tw',
      korea: 'kr',
      'south korea': 'kr',
      finland: 'fi',
      sweden: 'se',
      switzerland: 'ch',
      russia: 'ru',
      india: 'in',
      brazil: 'br',
      italy: 'it',
      spain: 'es',
      ireland: 'ie',
      poland: 'pl',
      ukraine: 'ua',
      austria: 'at',
      belgium: 'be',
      norway: 'no',
      denmark: 'dk',
      iceland: 'is',
      'new zealand': 'nz',
      malaysia: 'my',
      thailand: 'th',
      vietnam: 'vn',
      indonesia: 'id',
      philippines: 'ph',
    };
    if (map[c]) return map[c];
  }

  // 4. 从城市匹配
  if (city) {
    const ci = city.trim().toLowerCase();
    const cityMap: Record<string, string> = {
      tokyo: 'jp',
      osaka: 'jp',
      'hong kong': 'hk',
      'los angeles': 'us',
      'san jose': 'us',
      'silicon valley': 'us',
      seattle: 'us',
      chicago: 'us',
      dallas: 'us',
      'new york': 'us',
      miami: 'us',
      frankfurt: 'de',
      berlin: 'de',
      singapore: 'sg',
      london: 'gb',
      paris: 'fr',
      amsterdam: 'nl',
      sydney: 'au',
      melbourne: 'au',
      toronto: 'ca',
      vancouver: 'ca',
      taipei: 'tw',
      seoul: 'kr',
      helsinki: 'fi',
      stockholm: 'se',
      zurich: 'ch',
      geneva: 'ch',
      moscow: 'ru',
      mumbai: 'in',
      'sao paulo': 'br',
      bangkok: 'th',
      kuala_lumpur: 'my',
      'kuala lumpur': 'my',
    };
    if (cityMap[ci]) return cityMap[ci];
  }

  return null;
}

/**
 * 内置零外部依赖的矢量 SVG 国旗库 (100% 离线可用，不依赖 flagcdn/GFW，Windows/macOS/Linux 像素级一致呈现)
 */
const SVG_FLAGS: Record<string, React.ReactNode> = {
  // 🇯🇵 日本 (Japan)
  jp: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#ffffff" />
      <circle cx="320" cy="240" r="120" fill="#bc002d" />
    </svg>
  ),

  // 🇭🇰 香港 (Hong Kong)
  hk: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#de2910" />
      <g fill="#ffffff" transform="translate(320 240) scale(1.15)">
        {[0, 72, 144, 216, 288].map((angle, idx) => (
          <path
            key={idx}
            transform={`rotate(${angle})`}
            d="M 0,-12 C -22,-36 -32,-72 0,-102 C 32,-72 22,-36 0,-12 Z"
          />
        ))}
        <circle cx="0" cy="0" r="14" fill="#ffffff" />
        <circle cx="0" cy="0" r="6" fill="#de2910" />
      </g>
    </svg>
  ),

  // 🇺🇸 美国 (United States)
  us: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#b22234" />
      <path d="M0,37H640M0,111H640M0,185H640M0,259H640M0,333H640M0,407H640" stroke="#ffffff" strokeWidth="37" />
      <rect width="260" height="259" fill="#3c3b6e" />
      <g fill="#ffffff">
        <circle cx="43" cy="40" r="8" /><circle cx="130" cy="40" r="8" /><circle cx="217" cy="40" r="8" />
        <circle cx="86" cy="85" r="8" /><circle cx="173" cy="85" r="8" />
        <circle cx="43" cy="130" r="8" /><circle cx="130" cy="130" r="8" /><circle cx="217" cy="130" r="8" />
        <circle cx="86" cy="175" r="8" /><circle cx="173" cy="175" r="8" />
        <circle cx="43" cy="220" r="8" /><circle cx="130" cy="220" r="8" /><circle cx="217" cy="220" r="8" />
      </g>
    </svg>
  ),

  // 🇩🇪 德国 (Germany)
  de: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="160" fill="#000000" />
      <rect y="160" width="640" height="160" fill="#dd0000" />
      <rect y="320" width="640" height="160" fill="#ffce00" />
    </svg>
  ),

  // 🇸🇬 新加坡 (Singapore)
  sg: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="240" fill="#ed2939" />
      <rect y="240" width="640" height="240" fill="#ffffff" />
      <path d="M140,40 A80,80 0 1,0 140,200 A65,65 0 1,1 140,40 Z" fill="#ffffff" />
      <g fill="#ffffff" transform="translate(145 120) scale(0.65)">
        <polygon points="0,-25 7,-7 25,-7 10,4 15,22 0,11 -15,22 -10,4 -25,-7 -7,-7" transform="translate(45 -35)" />
        <polygon points="0,-25 7,-7 25,-7 10,4 15,22 0,11 -15,22 -10,4 -25,-7 -7,-7" transform="translate(75 -10)" />
        <polygon points="0,-25 7,-7 25,-7 10,4 15,22 0,11 -15,22 -10,4 -25,-7 -7,-7" transform="translate(65 25)" />
        <polygon points="0,-25 7,-7 25,-7 10,4 15,22 0,11 -15,22 -10,4 -25,-7 -7,-7" transform="translate(25 25)" />
        <polygon points="0,-25 7,-7 25,-7 10,4 15,22 0,11 -15,22 -10,4 -25,-7 -7,-7" transform="translate(15 -10)" />
      </g>
    </svg>
  ),

  // 🇬🇧 英国 (United Kingdom)
  gb: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <clipPath id="flag-gb-clip"><rect width="640" height="480" /></clipPath>
      <g clipPath="url(#flag-gb-clip)">
        <rect width="640" height="480" fill="#012169" />
        <path d="M0,0 L640,480 M640,0 L0,480" stroke="#ffffff" strokeWidth="64" />
        <path d="M0,0 L640,480 M640,0 L0,480" stroke="#c8102e" strokeWidth="22" />
        <path d="M320,0 V480 M0,240 H640" stroke="#ffffff" strokeWidth="100" />
        <path d="M320,0 V480 M0,240 H640" stroke="#c8102e" strokeWidth="60" />
      </g>
    </svg>
  ),

  // 🇫🇷 法国 (France)
  fr: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="213.3" height="480" fill="#002654" />
      <rect x="213.3" width="213.4" height="480" fill="#ffffff" />
      <rect x="426.7" width="213.3" height="480" fill="#ce1126" />
    </svg>
  ),

  // 🇳🇱 荷兰 (Netherlands)
  nl: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="160" fill="#ae1c28" />
      <rect y="160" width="640" height="160" fill="#ffffff" />
      <rect y="320" width="640" height="160" fill="#21468b" />
    </svg>
  ),

  // 🇦🇺 澳大利亚 (Australia)
  au: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#00008b" />
      <g transform="scale(0.5)">
        <rect width="640" height="480" fill="#012169" />
        <path d="M0,0 L640,480 M640,0 L0,480" stroke="#ffffff" strokeWidth="64" />
        <path d="M0,0 L640,480 M640,0 L0,480" stroke="#c8102e" strokeWidth="22" />
        <path d="M320,0 V480 M0,240 H640" stroke="#ffffff" strokeWidth="100" />
        <path d="M320,0 V480 M0,240 H640" stroke="#c8102e" strokeWidth="60" />
      </g>
      <circle cx="160" cy="360" r="30" fill="#ffffff" />
      <circle cx="480" cy="120" r="16" fill="#ffffff" />
      <circle cx="540" cy="200" r="16" fill="#ffffff" />
      <circle cx="480" cy="380" r="16" fill="#ffffff" />
      <circle cx="420" cy="220" r="16" fill="#ffffff" />
      <circle cx="500" cy="260" r="10" fill="#ffffff" />
    </svg>
  ),

  // 🇨🇦 加拿大 (Canada)
  ca: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="160" height="480" fill="#d80027" />
      <rect x="160" width="320" height="480" fill="#ffffff" />
      <rect x="480" width="160" height="480" fill="#d80027" />
      <path
        d="M320,105 L335,165 L380,155 L350,200 L395,225 L355,245 L365,285 L328,270 L328,340 L312,340 L312,270 L275,285 L285,245 L245,225 L290,200 L260,155 L305,165 Z"
        fill="#d80027"
      />
    </svg>
  ),

  // 🇨🇳 中国 (China)
  cn: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#de2910" />
      <polygon points="100,50 115,95 160,95 125,120 140,165 100,135 60,165 75,120 40,95 85,95" fill="#ffde00" />
      <circle cx="200" cy="60" r="14" fill="#ffde00" />
      <circle cx="240" cy="100" r="14" fill="#ffde00" />
      <circle cx="240" cy="160" r="14" fill="#ffde00" />
      <circle cx="200" cy="200" r="14" fill="#ffde00" />
    </svg>
  ),

  // 🇹🇼 台湾 (Taiwan)
  tw: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#fe0000" />
      <rect width="320" height="240" fill="#000095" />
      <circle cx="160" cy="120" r="60" fill="#ffffff" />
      <circle cx="160" cy="120" r="42" fill="#000095" />
      <circle cx="160" cy="120" r="36" fill="#ffffff" />
    </svg>
  ),

  // 🇰🇷 韩国 (South Korea)
  kr: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#ffffff" />
      <g transform="translate(320, 240) rotate(-30)">
        <path d="M-90,0 A90,90 0 0,1 90,0 A45,45 0 0,1 0,0 A45,45 0 0,0 -90,0 Z" fill="#cd2e3a" />
        <path d="M90,0 A90,90 0 0,1 -90,0 A45,45 0 0,1 0,0 A45,45 0 0,0 90,0 Z" fill="#0047a0" />
      </g>
      <g fill="#000000">
        <rect x="80" y="60" width="60" height="12" transform="rotate(35 110 66)" />
        <rect x="80" y="80" width="60" height="12" transform="rotate(35 110 86)" />
        <rect x="80" y="100" width="60" height="12" transform="rotate(35 110 106)" />
        <rect x="500" y="380" width="60" height="12" transform="rotate(35 530 386)" />
        <rect x="500" y="400" width="60" height="12" transform="rotate(35 530 406)" />
        <rect x="500" y="420" width="60" height="12" transform="rotate(35 530 426)" />
      </g>
    </svg>
  ),

  // 🇫🇮 芬兰 (Finland)
  fi: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#ffffff" />
      <rect x="180" width="90" height="480" fill="#003580" />
      <rect y="195" width="640" height="90" fill="#003580" />
    </svg>
  ),

  // 🇸🇪 瑞典 (Sweden)
  se: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#006aa7" />
      <rect x="200" width="80" height="480" fill="#fecc00" />
      <rect y="200" width="640" height="80" fill="#fecc00" />
    </svg>
  ),

  // 🇨🇭 瑞士 (Switzerland)
  ch: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#d52b1e" />
      <rect x="280" y="100" width="80" height="280" fill="#ffffff" />
      <rect x="180" y="200" width="280" height="80" fill="#ffffff" />
    </svg>
  ),

  // 🇷🇺 俄罗斯 (Russia)
  ru: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="160" fill="#ffffff" />
      <rect y="160" width="640" height="160" fill="#0039a6" />
      <rect y="320" width="640" height="160" fill="#d52b1e" />
    </svg>
  ),

  // 🇮🇹 意大利 (Italy)
  it: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="213.3" height="480" fill="#009246" />
      <rect x="213.3" width="213.4" height="480" fill="#ffffff" />
      <rect x="426.7" width="213.3" height="480" fill="#ce2b37" />
    </svg>
  ),

  // 🇪🇸 西班牙 (Spain)
  es: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="120" fill="#aa151b" />
      <rect y="120" width="640" height="240" fill="#f1bf00" />
      <rect y="360" width="640" height="120" fill="#aa151b" />
    </svg>
  ),

  // 🇮🇳 印度 (India)
  in: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="160" fill="#ff9933" />
      <rect y="160" width="640" height="160" fill="#ffffff" />
      <rect y="320" width="640" height="160" fill="#138808" />
      <circle cx="320" cy="240" r="45" fill="none" stroke="#000080" strokeWidth="6" />
    </svg>
  ),

  // 🇧🇷 巴西 (Brazil)
  br: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#009c3b" />
      <polygon points="320,40 600,240 320,440 40,240" fill="#ffdf00" />
      <circle cx="320" cy="240" r="100" fill="#002776" />
    </svg>
  ),

  // 🇵🇱 波兰 (Poland)
  pl: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="240" fill="#ffffff" />
      <rect y="240" width="640" height="240" fill="#dc143c" />
    </svg>
  ),

  // 🇺🇦 乌克兰 (Ukraine)
  ua: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="240" fill="#0057b7" />
      <rect y="240" width="640" height="240" fill="#ffd700" />
    </svg>
  ),

  // 🇳🇴 挪威 (Norway)
  no: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#ba0c2f" />
      <path d="M180,0 V480 M0,240 H640" stroke="#ffffff" strokeWidth="80" />
      <path d="M180,0 V480 M0,240 H640" stroke="#00205b" strokeWidth="40" />
    </svg>
  ),

  // 🇩🇰 丹麦 (Denmark)
  dk: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#c60c30" />
      <path d="M200,0 V480 M0,240 H640" stroke="#ffffff" strokeWidth="60" />
    </svg>
  ),

  // 🇹🇭 泰国 (Thailand)
  th: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="80" fill="#a51931" />
      <rect y="80" width="640" height="80" fill="#f4f5f8" />
      <rect y="160" width="640" height="160" fill="#2d2a4a" />
      <rect y="320" width="640" height="80" fill="#f4f5f8" />
      <rect y="400" width="640" height="80" fill="#a51931" />
    </svg>
  ),

  // 🇲🇾 马来西亚 (Malaysia)
  my: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#cc0000" />
      <path d="M0,34H640M0,102H640M0,170H640M0,238H640M0,306H640M0,374H640M0,442H640" stroke="#ffffff" strokeWidth="34" />
      <rect width="320" height="272" fill="#000066" />
      <circle cx="160" cy="136" r="70" fill="#ffcc00" />
      <circle cx="185" cy="136" r="60" fill="#000066" />
      <polygon points="190,80 200,120 240,136 200,152 190,192 180,152 140,136 180,120" fill="#ffcc00" />
    </svg>
  ),

  // 🇻🇳 越南 (Vietnam)
  vn: (
    <svg viewBox="0 0 640 480" className="w-full h-full">
      <rect width="640" height="480" fill="#da251d" />
      <polygon points="320,100 355,210 470,210 380,275 415,385 320,320 225,385 260,275 170,210 285,210" fill="#ffff00" />
    </svg>
  ),
};

/**
 * 跨平台通用国旗渲染组件 (100% 离线内置高清矢量 SVG，彻底解决 Windows Segoe UI Emoji 字母回退问题)
 */
export const CountryFlag: React.FC<CountryFlagProps> = ({
  flag = '',
  country = '',
  code = '',
  city = '',
  className = 'w-5 h-3.5 object-cover rounded-[3px] shadow-sm overflow-hidden shrink-0 inline-flex items-center justify-center border border-white/10',
}) => {
  const isoCode = extractIsoCountryCode(flag, code, country, city);

  // 1. 如果内置了对应的 SVG 国旗，优先直接渲染内联矢量 SVG (极速、0网络延迟、100%可靠)
  if (isoCode && SVG_FLAGS[isoCode]) {
    return (
      <span className={className} title={country || code || flag || isoCode.toUpperCase()}>
        {SVG_FLAGS[isoCode]}
      </span>
    );
  }

  // 2. 兜底世界地球仪矢量徽标
  return (
    <span
      className={`${className} bg-slate-800 text-[10px] font-mono font-bold text-cyan-300 flex items-center justify-center select-none`}
      title={country || code || flag || 'Global Node'}
    >
      <svg viewBox="0 0 640 480" className="w-full h-full">
        <rect width="640" height="480" fill="#0f172a" />
        <circle cx="320" cy="240" r="140" fill="none" stroke="#38bdf8" strokeWidth="24" />
        <ellipse cx="320" cy="240" rx="65" ry="140" fill="none" stroke="#38bdf8" strokeWidth="20" />
        <line x1="180" y1="240" x2="460" y2="240" stroke="#38bdf8" strokeWidth="20" />
        <line x1="205" y1="170" x2="435" y2="170" stroke="#38bdf8" strokeWidth="16" />
        <line x1="205" y1="310" x2="435" y2="310" stroke="#38bdf8" strokeWidth="16" />
      </svg>
    </span>
  );
};
