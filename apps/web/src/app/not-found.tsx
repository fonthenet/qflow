import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#f8fafc', color: '#1e293b', padding: '2rem',
    }}>
      <div style={{ fontSize: '6rem', fontWeight: 700, color: '#3b82f6', lineHeight: 1 }}>404</div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '1rem' }}>Page not found</h1>
      <p style={{ color: '#64748b', marginTop: '0.5rem', textAlign: 'center' }}>
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link href="/" style={{
        marginTop: '2rem', padding: '0.75rem 2rem', background: '#3b82f6', color: 'white',
        borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 500, fontSize: '0.95rem',
      }}>
        Go to Home
      </Link>
      <p style={{ marginTop: '3rem', fontSize: '0.8rem', color: '#94a3b8' }}>Qflo — Smart Queue Management</p>
    </div>
  );
}
