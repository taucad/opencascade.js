'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ThreeViewer } from './three-viewer';

export type OcjsExampleProps = {
  readonly title: string;
  readonly description?: string;
  /** Raw TypeScript source string — typically supplied via a server-side `?raw` import. */
  readonly source: string;
  /** Function returning a GLB byte array. Receives the lazy-initialised OCCT module. */
  readonly run: (oc: unknown) => Promise<Uint8Array>;
  readonly defaultOpen?: boolean;
};

const initState: { promise?: Promise<unknown> } = {};
const lazyInitOcct = async (): Promise<unknown> => {
  if (!initState.promise) {
    initState.promise = (async () => {
      const initModule: { default: (options?: { locateFile?: (file: string) => string }) => Promise<unknown> } =
        await import('cascadic');
      return initModule.default({
        locateFile: (file: string) => `/${file}`,
      });
    })();
  }
  return initState.promise;
};

/**
 * Embeds a runnable OCCT example inside an MDX page. The `run` callback is
 * executed in the browser against a lazily-initialised `cascadic`
 * instance and the resulting GLB bytes are handed to `<ThreeViewer>`.
 */
export const OcjsExample = ({
  title,
  description,
  source,
  run,
  defaultOpen = false,
}: OcjsExampleProps): ReactNode => {
  const [glb, setGlb] = useState<Uint8Array | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sourceOpen, setSourceOpen] = useState(defaultOpen);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async example runner owns the follow-up setState
    setRunning(true);
    setError(undefined);
    void (async () => {
      try {
        const oc = await lazyInitOcct();
        const bytes = await run(oc);
        if (cancelled) return;
        setGlb(bytes);
      } catch (caught: unknown) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      <header className="flex items-center justify-between border-b border-fd-border bg-fd-muted/40 px-4 py-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {description ? (
            <div className="text-xs text-fd-muted-foreground">{description}</div>
          ) : undefined}
        </div>
        <button
          type="button"
          onClick={() => setSourceOpen((open) => !open)}
          className="text-xs text-fd-muted-foreground hover:text-fd-foreground"
        >
          {sourceOpen ? 'Hide source' : 'Show source'}
        </button>
      </header>
      <div>
        {running ? (
          <div className="px-4 py-6 text-sm text-fd-muted-foreground">Initialising OCCT…</div>
        ) : undefined}
        {error ? (
          <div className="px-4 py-6 text-sm text-red-600 dark:text-red-400">Example failed: {error}</div>
        ) : undefined}
        {glb ? <ThreeViewer glb={glb} /> : undefined}
      </div>
      {sourceOpen ? (
        <pre className="overflow-x-auto border-t border-fd-border bg-fd-muted/40 px-4 py-3 text-xs leading-relaxed">
          <code>{source}</code>
        </pre>
      ) : undefined}
    </figure>
  );
};
