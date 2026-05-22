import Link from 'next/link';
import type { ReactNode } from 'react';

const personaCards = [
  {
    title: 'npm consumer',
    description: 'Install `@taucad/opencascade.js@beta`, render a box, export STEP — in 4 minutes.',
    href: '/docs/package/getting-started/quick-start-npm',
    cta: 'Start with npm',
  },
  {
    title: 'Docker consumer',
    description: 'Pull a GHCR image, link a custom YAML, build a trimmed wasm in 2 minutes.',
    href: '/docs/toolchain/getting-started/quick-start-docker',
    cta: 'Start with Docker',
  },
  {
    title: 'Library author',
    description: 'Trim symbols, add custom C++, ship reproducible CI — extend without forking.',
    href: '/docs/toolchain/guides/extend-with-cpp',
    cta: 'Extend with C++',
  },
  {
    title: 'AI agent / LLM',
    description: 'Fetch `/llms.txt` for the full surface, or query individual `.mdx` pages.',
    href: '/llms.txt',
    cta: 'Read llms.txt',
  },
] as const;

const HomePage = (): ReactNode => {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          OpenCascade.js
        </h1>
        <p className="mt-3 max-w-2xl text-balance text-lg text-fd-muted-foreground">
          The OpenCascade CAD kernel compiled to WebAssembly with full TypeScript bindings,
          reproducible Docker builds, and multi-arch container images. Trim your wasm to the symbols
          you need; extend with your own C++ without forking.
        </p>
      </header>

      <section aria-label="Choose your path" className="grid gap-4 md:grid-cols-2">
        {personaCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group block rounded-xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-fd-primary"
          >
            <div className="text-base font-medium">{card.title}</div>
            <div className="mt-1 text-sm text-fd-muted-foreground">{card.description}</div>
            <div className="mt-3 text-sm font-medium text-fd-primary group-hover:underline">
              {card.cta} →
            </div>
          </Link>
        ))}
      </section>

      <section className="mt-10">
        <Link
          href="/docs/package/getting-started/faq"
          className="text-sm text-fd-muted-foreground hover:text-fd-primary hover:underline"
        >
          FAQ — fork status, maintenance, contributing →
        </Link>
      </section>

      <section className="mt-14">
        <h2 className="mb-3 text-xl font-semibold">Quickstart (npm)</h2>
        <pre className="overflow-x-auto rounded-lg border border-fd-border bg-fd-muted/40 p-4 text-sm leading-relaxed">
          <code>{`pnpm add @taucad/opencascade.js@beta three
# Render a 60×40×20 box with a 3 mm fillet, export GLB, view in three.js.
# Full source at /docs/package/getting-started/quick-start-npm`}</code>
        </pre>
      </section>
    </main>
  );
};

export default HomePage;
