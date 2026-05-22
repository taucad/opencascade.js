import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { metadata } from '../app/layout';
import { NavTitle, TauAttributionFooter } from '../app/layout.config';

describe('branding layout metadata', () => {
  it('should configure favicon icons', () => {
    expect(metadata.icons).toEqual({
      icon: '/favicon.ico',
      apple: '/favicon.ico',
    });
  });
});

describe('branding layout chrome', () => {
  it('should render nav title with logo and site name', () => {
    const { container } = render(<NavTitle />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logo.svg');
    expect(screen.getByText('OpenCascade.js')).toBeTruthy();
  });

  it('should render Tau attribution footer linking to the FAQ', () => {
    render(<TauAttributionFooter />);
    const faqLink = screen.getByRole('link', { name: 'FAQ' });
    expect(faqLink.getAttribute('href')).toBe('/docs/package/getting-started/faq');
    expect(screen.getByText(/Maintained by/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tau' }).getAttribute('href')).toBe('https://tau.new');
  });
});
