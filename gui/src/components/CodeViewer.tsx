import React, { useMemo } from 'react';
import { FileCode } from 'lucide-react';

interface CodeViewerProps {
  code: string;
  language: 'wg' | 'bird';
  showLineNumbers?: boolean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightLineToHtml(line: string, language: 'wg' | 'bird'): string {
  const trimmed = line.trim();
  const escaped = escapeHtml(line);

  // 1. Comments
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return `<span class="text-slate-500 italic">${escaped}</span>`;
  }

  // 2. WireGuard Syntax Highlighting
  if (language === 'wg') {
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return `<span class="text-cyan-400 font-semibold tracking-wide">${escaped}</span>`;
    }

    if (line.includes('=')) {
      const idx = line.indexOf('=');
      const key = escapeHtml(line.slice(0, idx));
      const val = escapeHtml(line.slice(idx + 1));

      let valClass = 'text-cyan-100';
      if (val.includes('&lt;YOUR_PRIVATE_KEY&gt;') || val.includes('&lt;YOUR_IPV6_LLA&gt;')) {
        valClass = 'text-yellow-200/85';
      } else if (line.trim().startsWith('PostUp')) {
        valClass = 'text-slate-300';
      }

      return `<span class="text-slate-300 font-medium">${key}</span><span class="text-slate-600">=</span><span class="${valClass}">${val}</span>`;
    }
  }

  // 3. BIRD Syntax Highlighting
  if (language === 'bird') {
    if (trimmed.startsWith('protocol bgp')) {
      const match = line.match(/^(\s*protocol\s+bgp\s+)(\S+)(\s+from\s+dnpeers\s*\{.*)$/);
      if (match) {
        return `<span class="text-cyan-400 font-semibold">${escapeHtml(match[1])}</span><span class="text-cyan-100">${escapeHtml(match[2])}</span><span class="text-slate-400"> from </span><span class="text-slate-300">${escapeHtml(match[3].replace(/^\s+from\s+/, ''))}</span>`;
      }
      return `<span class="text-cyan-400 font-semibold">${escaped}</span>`;
    }

    if (trimmed.startsWith('neighbor')) {
      return escaped
        .replace(/neighbor/g, '<span class="text-cyan-400">neighbor</span>')
        .replace(/as\s+(\d+);?/g, '<span class="text-slate-400">as </span><span class="text-yellow-200/85">$1;</span>');
    }

    if (trimmed.startsWith('ipv4') || trimmed.startsWith('ipv6')) {
      return `<span class="text-cyan-400">${escaped}</span>`;
    }

    if (trimmed.includes('extended next hop on')) {
      return `<span class="text-slate-300">${escaped}</span>`;
    }

    if (trimmed.includes('import filter') || trimmed.includes('export filter')) {
      const parts = escaped.split(/filter/);
      return `<span class="text-cyan-400">${parts[0]}filter </span><span class="text-slate-300">${parts[1] || ''}</span>`;
    }

    if (trimmed === '}' || trimmed === '};') {
      return `<span class="text-slate-500">${escaped}</span>`;
    }
  }

  return `<span class="text-slate-200">${escaped}</span>`;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  code,
  language,
  showLineNumbers = true,
}) => {
  const lines = useMemo(() => {
    return code.split('\n');
  }, [code]);

  const filename = language === 'wg' ? 'wg0.conf' : 'bird.conf';

  return (
    <div
      translate="no"
      className="notranslate flex flex-col h-full rounded-2xl bg-black/85 border border-white/10 overflow-hidden shadow-2xl"
    >
      {/* Clean Minimal Header: Filename & Line Count only */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/10 text-xs font-mono select-none">
        <div className="flex items-center gap-2">
          <FileCode className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-300 font-mono text-xs font-medium">
            {filename}
          </span>
        </div>

        <span className="text-slate-500 font-mono text-[11px]">
          {lines.length} lines
        </span>
      </div>

      {/* Code Area with Line Numbers */}
      <div className="flex-1 overflow-auto p-3.5 sm:p-4 text-xs font-mono leading-relaxed scrollbar-thin">
        <div key={language} className="table w-full">
          {lines.map((line, idx) => (
            <div key={`${language}-${idx}`} className="table-row hover:bg-white/[0.02] transition-colors">
              {showLineNumbers && (
                <span className="table-cell pr-4 text-right text-slate-600 select-none text-[11px] font-mono w-8 shrink-0">
                  {idx + 1}
                </span>
              )}
              <span
                className="table-cell whitespace-pre font-mono"
                dangerouslySetInnerHTML={{ __html: highlightLineToHtml(line, language) }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
