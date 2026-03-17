import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { TicketResponse } from './api';

interface HistoryEntry {
  token: string;
  ticketNumber: string;
  officeName: string;
  serviceName: string;
  status: string;
  date: string;
  /** Populated from ticket data so we can build favorites */
  officeId?: string;
  kioskSlug?: string;
}

export interface FavoriteBusiness {
  id: string; // unique key (officeId or slug-based)
  name: string;
  address?: string;
  /** Kiosk slug for direct join — e.g. /kiosk/{slug} */
  kioskSlug?: string;
  /** Join token for virtual join — e.g. /join/{token} */
  joinToken?: string;
  /** Last visited date */
  lastVisited?: string;
  /** Number of visits */
  visitCount: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
  activeToken: string | null;
  activeTicket: TicketResponse | null;
  history: HistoryEntry[];
  favorites: FavoriteBusiness[];
  customerName: string;
  customerPhone: string;
  themeMode: ThemeMode;

  setActiveToken: (token: string | null) => void;
  setActiveTicket: (ticket: TicketResponse | null) => void;
  addToHistory: (entry: HistoryEntry) => void;
  clearActiveTicket: () => void;
  setCustomerInfo: (name: string, phone: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  addFavorite: (biz: Omit<FavoriteBusiness, 'visitCount'>) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  /** Increment visit count and update lastVisited for a business */
  recordVisit: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeToken: null,
      activeTicket: null,
      history: [],
      favorites: [],
      customerName: '',
      customerPhone: '',
      themeMode: 'dark' as ThemeMode,

      setActiveToken: (token) => set({ activeToken: token }),

      setActiveTicket: (ticket) => set({ activeTicket: ticket }),

      addToHistory: (entry) => {
        const existing = get().history;
        const filtered = existing.filter((h) => h.token !== entry.token);
        set({ history: [entry, ...filtered].slice(0, 50) });
      },

      clearActiveTicket: () => {
        const ticket = get().activeTicket;
        if (ticket) {
          get().addToHistory({
            token: ticket.qr_token,
            ticketNumber: ticket.ticket_number,
            officeName: ticket.office?.name ?? 'Unknown',
            serviceName: ticket.service?.name ?? ticket.department?.name ?? 'General',
            status: ticket.status,
            date: new Date().toISOString(),
            officeId: ticket.office?.id,
          });

          // Auto-track visited businesses for the Places tab
          if (ticket.office?.id) {
            const bizId = ticket.office.id;
            const favs = get().favorites;
            const existing = favs.find((f) => f.id === bizId);
            if (existing) {
              set({
                favorites: favs.map((f) =>
                  f.id === bizId
                    ? { ...f, visitCount: f.visitCount + 1, lastVisited: new Date().toISOString() }
                    : f
                ),
              });
            }
            // Don't auto-add to favorites — user chooses to favorite
          }
        }
        set({ activeToken: null, activeTicket: null });
      },

      setCustomerInfo: (name, phone) => set({ customerName: name, customerPhone: phone }),
      setThemeMode: (mode) => set({ themeMode: mode }),

      addFavorite: (biz) => {
        const favs = get().favorites;
        if (favs.some((f) => f.id === biz.id)) return;
        set({ favorites: [{ ...biz, visitCount: biz.visitCount ?? 0 }, ...favs] });
      },

      removeFavorite: (id) => {
        set({ favorites: get().favorites.filter((f) => f.id !== id) });
      },

      isFavorite: (id) => get().favorites.some((f) => f.id === id),

      recordVisit: (id) => {
        const favs = get().favorites;
        set({
          favorites: favs.map((f) =>
            f.id === id
              ? { ...f, visitCount: f.visitCount + 1, lastVisited: new Date().toISOString() }
              : f
          ),
        });
      },
    }),
    {
      name: 'queueflow-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeToken: state.activeToken,
        history: state.history,
        favorites: state.favorites,
        customerName: state.customerName,
        customerPhone: state.customerPhone,
        themeMode: state.themeMode,
      }),
    }
  )
);
