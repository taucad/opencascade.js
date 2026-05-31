'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link2, Check } from 'lucide-react';

export type ApiAnchorProps = {
  /** Stable element id this anchor targets (also becomes the URL hash). */
  readonly anchorId: string;
  /** Human-readable label (class or member name) for accessible naming. */
  readonly label: string;
};

/**
 * Hover-revealed "copy link" affordance shown to the right of a class title
 * or member name. Clicking copies the absolute deep-link URL (`…#<anchorId>`)
 * to the clipboard, updates the address-bar hash, and flashes a tick on
 * success — reusing the tick-on-copy pattern from `tag-badge.tsx`.
 *
 * The icon stays hidden until the surrounding `group` element (the card
 * header / member row) is hovered or this button is keyboard-focused,
 * matching the standard docs "#"/link-icon affordance. Replacing the hash via
 * `history.replaceState` (rather than assigning `location.hash`) avoids both a
 * history entry and a native jump — the item is already in view — while the
 * manual `hashchange` dispatch lets `ApiHashHighlight` flash the linked target
 * so the user can confirm exactly what was copied.
 */
export const ApiAnchor = ({ anchorId, label }: ApiAnchorProps): ReactNode => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    const origin = globalThis.location?.origin ?? '';
    const pathname = globalThis.location?.pathname ?? '';
    // Update the hash + flash the target first so the anchor still works even
    // if the Clipboard API is unavailable (it rejects when the document is
    // unfocused or permission is denied). The tick only shows on a real copy.
    globalThis.history?.replaceState(null, '', `#${anchorId}`);
    globalThis.dispatchEvent?.(new HashChangeEvent('hashchange'));
    try {
      await globalThis.navigator?.clipboard?.writeText(`${origin}${pathname}#${anchorId}`);
      setCopied(true);
      globalThis.setTimeout?.(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked; the address-bar hash is already updated, so the
      // deep-link remains shareable via the URL bar.
    }
  };

  const Icon = copied ? Check : Link2;
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? `Copied link to ${label}` : `Copy link to ${label}`}
      title={copied ? 'Copied link' : 'Copy link'}
      className={`ml-1 inline-flex size-5 shrink-0 translate-y-px items-center justify-center rounded text-fd-muted-foreground transition-[opacity,color] hover:text-fd-foreground focus-visible:opacity-100 group-hover:opacity-100 ${
        copied ? 'text-fd-foreground opacity-100' : 'opacity-0'
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
};
