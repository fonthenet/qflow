'use client';

import { useEffect } from 'react';

interface Props {
  officeId: string;
  organizationId: string;
}

/**
 * When running inside the Electron desktop app, automatically
 * register the current office so the cloud knows this PC is connected.
 */
export function DesktopAutoRegister({ officeId, organizationId }: Props) {
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.desktop?.setOffice) return;

    // Tell the desktop main process which office we're logged into
    api.desktop.setOffice({ id: officeId, organization_id: organizationId });
    console.log('[Desktop] Auto-registered office:', officeId);
  }, [officeId, organizationId]);

  return null; // No UI — just a side-effect
}
