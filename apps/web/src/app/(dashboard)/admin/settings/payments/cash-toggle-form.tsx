'use client';

import { useTransition } from 'react';

interface CashToggleFormProps {
  orgId: string;
  acceptsCash: boolean;
  setAcceptsCash: (orgId: string, accepts: boolean) => Promise<void>;
}

export function CashToggleForm({ orgId, acceptsCash, setAcceptsCash }: CashToggleFormProps) {
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    startTransition(async () => {
      await setAcceptsCash(orgId, checked);
    });
  }

  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        defaultChecked={acceptsCash}
        onChange={handleChange}
        disabled={isPending}
        className="mt-0.5 h-4 w-4 accent-primary cursor-pointer"
        style={{ colorScheme: 'light dark' }}
      />
      <span>
        <span className="block text-sm font-medium text-foreground">We accept cash</span>
        <span className="block text-xs text-muted-foreground mt-0.5">
          Optional. When enabled, customers see a cash notice on their ticket page and in
          WhatsApp confirmations.
        </span>
      </span>
    </label>
  );
}
