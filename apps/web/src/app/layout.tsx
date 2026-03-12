import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueueFlow - Smart Queue Management',
  description: 'Modern queue and ticketing management system for businesses',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
