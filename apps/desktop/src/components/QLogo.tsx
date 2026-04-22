import logoUrl from '../assets/qflo-logo.png';

/**
 * Branded Qflo logo — same blue-gradient Q used on the mobile app icon
 * and the Windows executable. Size in px, defaults to 64.
 */
export function QLogo({ size = 64, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <img
      src={logoUrl}
      alt="Qflo"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        display: 'block',
        objectFit: 'contain',
        ...style,
      }}
    />
  );
}

export { logoUrl as qfloLogoUrl };
