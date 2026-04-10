import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface OperatorSession {
  staffId: string;
  deskId: string | null;
  deskName: string | null;
  officeId: string;
  officeName: string;
  departmentId: string | null;
  departmentName: string | null;
}

interface QueueTicket {
  id: string;
  ticket_number: string;
  status: string;
  customer_data: { name?: string; phone?: string; email?: string } | null;
  priority_category_id: string | null;
  service_name: string | null;
  department_name: string | null;
  called_at: string | null;
  created_at: string;
}

interface OperatorState {
  session: OperatorSession | null;
  currentTicket: QueueTicket | null;
  waitingCount: number;

  setSession: (session: OperatorSession) => void;
  clearSession: () => void;
  setCurrentTicket: (ticket: QueueTicket | null) => void;
  setWaitingCount: (count: number) => void;
}

export const useOperatorStore = create<OperatorState>()(
  persist(
    (set) => ({
      session: null,
      currentTicket: null,
      waitingCount: 0,

      setSession: (session) => set({ session }),
      clearSession: () => set({ session: null, currentTicket: null, waitingCount: 0 }),
      setCurrentTicket: (ticket) => set({ currentTicket: ticket }),
      setWaitingCount: (count) => set({ waitingCount: count }),
    }),
    {
      name: 'qflo-operator',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ session: state.session }),
    }
  )
);
