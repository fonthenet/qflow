'use client';

import { createContext, useContext } from 'react';
import type { IndustryTerminology } from '@/lib/data/industry-templates';
import { getDefaultTerminology } from '@/lib/data/industry-templates';

const TerminologyContext = createContext<IndustryTerminology>(getDefaultTerminology());

export function TerminologyProvider({
  terminology,
  children,
}: {
  terminology: IndustryTerminology;
  children: React.ReactNode;
}) {
  return (
    <TerminologyContext.Provider value={terminology}>
      {children}
    </TerminologyContext.Provider>
  );
}

export function useTerminology() {
  return useContext(TerminologyContext);
}
