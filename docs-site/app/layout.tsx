import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { SITE_TITLE, SITE_DESCRIPTION, SITE_URL } from '../lib/site';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s — OpenCascade.js' },
  description: SITE_DESCRIPTION,
  icons: {
    icon: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

const RootLayout = ({ children }: { readonly children: ReactNode }): React.JSX.Element => {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
};

export default RootLayout;
