import { createElement, type ReactNode } from 'react';
import { icons, type LucideIcon } from 'lucide-react';

/**
 * Parses Tau-style icon strings of the form `"namespace:icon-id extra classes"`
 * and renders them as React elements. Mirrors `apps/ui/app/components/icons/docs-icon.tsx`
 * so `meta.json` icons stay consistent with the upstream Tau pattern.
 *
 * Examples:
 *  - `"lucide:package"` → `<Package />`
 *  - `"lucide:wrench text-amber"` → `<Wrench className="text-amber" />`
 */
export const resolveIcon = (icon: string | undefined): ReactNode => {
  if (icon === undefined) return undefined;
  const trimmed = icon.trim();
  if (trimmed === '') return undefined;

  const wsMatch = /\s/.exec(trimmed);
  const head = wsMatch === null ? trimmed : trimmed.slice(0, wsMatch.index);
  const tail = wsMatch === null ? undefined : trimmed.slice(wsMatch.index).trim();
  const className = tail !== undefined && tail !== '' ? tail : undefined;

  const colonIndex = head.indexOf(':');
  const namespace = colonIndex === -1 ? 'lucide' : head.slice(0, colonIndex);
  const id = colonIndex === -1 ? head : head.slice(colonIndex + 1);

  if (namespace !== 'lucide' || id === '') {
    console.warn(`[icon-resolver] Unsupported icon string: "${icon}"`);
    return undefined;
  }

  const pascalCase = id
    .split('-')
    .map((segment) => (segment.length === 0 ? segment : segment[0]!.toUpperCase() + segment.slice(1)))
    .join('');

  const Component = (icons as Record<string, LucideIcon | undefined>)[pascalCase];
  if (!Component) {
    console.warn(`[icon-resolver] Unknown lucide icon: "${id}" (PascalCase: "${pascalCase}")`);
    return undefined;
  }

  return createElement(Component, { className });
};
