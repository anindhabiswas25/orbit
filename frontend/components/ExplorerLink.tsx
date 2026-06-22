'use client';
import { txUrl, addressUrl, shorten, EXPLORER_BASE } from '@/lib/explorer';

type Kind = 'tx' | 'address';

interface Props {
  value?: string | null;
  kind: Kind;
  base?: string;
  label?: string;     // override the displayed text
  lead?: number;
  tail?: number;
  className?: string;
  showIcon?: boolean;
}

/**
 * Renders a monospace, clickable link to Snowtrace for a tx hash or address.
 * Falls back to a muted dash when the value is missing.
 */
export default function ExplorerLink({
  value,
  kind,
  base = EXPLORER_BASE,
  label,
  lead = 6,
  tail = 4,
  className = '',
  showIcon = true,
}: Props) {
  if (!value) {
    return <span className="font-mono text-muted-foreground/50">—</span>;
  }
  const href = kind === 'tx' ? txUrl(value, base) : addressUrl(value, base);
  const text = label ?? shorten(value, lead, tail);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${kind === 'tx' ? 'Transaction' : 'Address'}: ${value}\nOpen on Snowtrace`}
      className={`group inline-flex items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      <span className="underline decoration-border decoration-dotted underline-offset-2 group-hover:decoration-foreground">
        {text}
      </span>
      {showIcon && (
        <svg
          className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      )}
    </a>
  );
}
