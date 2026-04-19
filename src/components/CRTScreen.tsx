import { type ReactNode } from 'react';
import { useShellOS } from '../hooks/useShellOS';

interface CRTScreenProps {
  children: ReactNode;
}

/**
 * CRT screen wrapper. Barrel distortion removed — feDisplacementMap
 * produces unavoidable stair-stepping in Chrome. Screen curvature is
 * conveyed through CSS (border-radius, inset shadows, glass highlights).
 */
export default function CRTScreen({ children }: CRTScreenProps) {
  const { settings } = useShellOS();

  return (
    <div className={settings.crtEnabled ? 'crt-screen-glow' : ''}>
      {children}
    </div>
  );
}
