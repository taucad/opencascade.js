import type { ReactNode } from 'react';
import { loadShard } from './api-data';
import { ApiClassCard } from './api-class-card';

export type ApiPackagePageProps = {
  readonly shardKey: string;
};

/**
 * RSC. Reads the shard JSON at build time, renders one `ApiClassCard` per
 * bound class inline, and generates a sidebar class jumplist. Build-time
 * only — no client JS for the class cards themselves.
 */
export const ApiPackagePage = async ({ shardKey }: ApiPackagePageProps): Promise<ReactNode> => {
  const shard = await loadShard(shardKey);
  const classes = shard.classes ?? [];

  if (classes.length === 0) {
    return (
      <div className="not-prose rounded-md border border-fd-border bg-fd-muted/40 px-4 py-3 text-sm text-fd-muted-foreground">
        No bound classes in this package.
      </div>
    );
  }

  return (
    <div className="not-prose grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="hidden md:block">
        <nav
          aria-label="Classes in this package"
          className="sticky top-20 space-y-2 text-sm"
        >
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fd-muted-foreground">
            Classes <span className="ml-0.5 tabular-nums">({classes.length})</span>
          </div>
          <ul className="space-y-0.5">
            {classes.map((cls) => (
              <li key={cls.name}>
                <a
                  href={`#${cls.name}`}
                  className="block truncate rounded px-1.5 py-0.5 font-mono text-xs text-fd-muted-foreground no-underline transition-colors hover:bg-fd-accent/40 hover:text-fd-foreground"
                >
                  {cls.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="space-y-6">
        {classes.map((cls) => (
          <ApiClassCard key={cls.name} cls={cls} />
        ))}
      </div>
    </div>
  );
};
