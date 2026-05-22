'use client';

import dynamic from 'next/dynamic';

// Next 16 forbids `next/dynamic({ ssr: false })` inside Server Components, so
// the dynamic import lives in this tiny client wrapper. The server-rendered
// HomePage imports `<OcjsViewerLoader />`, which then loads the WASM-driven
// `<OcjsViewer />` only in the browser.
const OcjsViewer = dynamic(
  () => import('./OcjsViewer').then((m) => m.OcjsViewer),
  {
    ssr: false,
    loading: () => <div style={{ padding: 16 }}>loading viewer…</div>,
  },
);

export function OcjsViewerLoader(): React.ReactElement {
  return <OcjsViewer />;
}
