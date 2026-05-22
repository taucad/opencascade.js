# Legacy starter templates (v2-beta)

These templates target `opencascade.js@beta.x` (the pre-rename, pre-ESM-only line). They are kept here for archaeological reference and to support consumers who have not yet migrated to v3.

New work should start from [`..`](../), which demonstrates the canonical loading and disposal patterns for `@taucad/opencascade.js@beta` (the v3 line).

## Inventory

| Template                              | Stack (v2-beta era)                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| `ocjs-create-next-app-12`             | Next 12 + opencascade.js@beta                                |
| `ocjs-create-nuxt-app`                | Nuxt 2/3 + opencascade.js@beta                               |
| `ocjs-create-react-app-5`             | Create React App 5 + opencascade.js@beta                     |
| `ocjs-create-react-app-typescript`    | Create React App + TypeScript + opencascade.js@beta          |
| `ocjs-create-react-app-web-worker`    | Create React App + Web Worker pattern + opencascade.js@beta  |
| `ocjs-node`                           | Node CommonJS + opencascade.js@beta                          |
| `ocjs-vite-model-viewer`              | Vite + model-viewer + opencascade.js@beta                    |

## Why they are not updated

The v2-beta line shipped as a multi-variant facade with implicit `init()` overloads and `_2`/`_3` numbered subclasses for OCCT overloaded methods. The v3 line replaced both with a single ESM entry, an explicit `init({ locateFile })`, and val-based overload dispatch — see [BREAKING_CHANGES.md](../../BREAKING_CHANGES.md) for the full delta.

Updating the legacy templates would obscure the v3 surface. Consumers on v2-beta should follow the migration guide to land on v3; new consumers should clone from `../<template>` instead.

## Lifecycle

These templates will be deleted in a future release once at least one full release cycle has confirmed that the v3 templates fully cover their use cases.
