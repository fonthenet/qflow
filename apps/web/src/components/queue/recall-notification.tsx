'use client';

import { useState } from 'react';

interface RecallNotificationProps {
  ticketNumber: string;
  deskName: string;
}

export function RecallNotification({ ticketNumber, deskName }: RecallNotificationProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (acknowledged) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800">
        Thank you! The desk has been notified that you are on your way.
      </div>
    );
  }

  return (
    <div className="animate-pulse rounded-lg border-2 border-amber-400 bg-amber-500 px-6 py-5 shadow-lg">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="text-3xl">🔔</div>
        <div>
          <p className="text-lg font-bold text-white">Please return!</p>
          <p className="mt-1 text-sm font-medium text-amber-50">
            Your number{' '}
            <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono font-bold">
              {ticketNumber}
            </span>{' '}
            is being recalled to{' '}
            <span className="font-bold">{deskName}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAcknowledged(true)}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-amber-700 shadow-sm transition-transform hover:scale-105 hover:bg-amber-50 active:scale-95"
        >
          I&apos;m on my way
        </button>
      </div>
    </div>
  );
}
