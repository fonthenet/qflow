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
  officeId?: string;
  kioskSlug?: string;
  joinToken?: string;
}

/** A business the user has discovered by scanning a QR code or opening a join link. */
export interface SavedPlace {
  id: string; // officeId
  name: string;
  address?: string | null;
  /** Kiosk slug — enables queue peek + kiosk flow */
  kioskSlug?: string;
  /** Virtual join token */
  joinToken?: string;
  /** ISO timestamp of first scan */
  firstSeenAt: string;
  /** ISO timestamp of most recent scan */
  lastSeenAt: string;
  /** Total tickets taken at this place */
  visitCount: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
  activeToken: string | null;
  activeTicket: TicketResponse | null;
  /** Kiosk slug active when the current ticket was issued */
  activeKioskSlug: string | null;
  /** Join token active when the current ticket was issued */
  activeJoinToken: string | null;
  history: HistoryEntry[];
  /** All businesses the user has ever scanned or joined — the Places tab source of truth */
  savedPlaces: SavedPlace[];
  customerName: string;
  customerPhone: string;
  themeMode: ThemeMode;

  setActiveToken: (token: string | null) => void;
  setActiveTicket: (ticket: TicketResponse | null) => void;
  setActiveKioskSlug: (slug: string | null) => void;
  setActiveJoinToken: (token: string | null) => void;
  addToHistory: (entry: HistoryEntry) => void;
  clearActiveTicket: () => void;
  setCustomerInfo: (name: string, phone: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  /** Called when a business is first encountered (QR scan, join link). Creates or updates savedPlaces entry. */
  recordPlace: (place: Omit<SavedPlace, 'firstSeenAt' | 'lastSeenAt' | 'visitCount'>) => void;
  /** Remove a business from saved places */
  removePlace: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeToken: null,
      activeTicket: null,
      activeKioskSlug: null,
      activeJoinToken: null,
      history: [],
      savedPlaces: [],
      customerName: '',
      customerPhone: '',
      themeMode: 'dark' as ThemeMode,

      setActiveToken: (token) => set({ activeToken: token }),

      setActiveTicket: (ticket) => set({ activeTicket: ticket }),

      setActiveKioskSlug: (slug) => set({ activeKioskSlug: slug }),

      setActiveJoinToken: (token) => set({ activeJoinToken: token }),

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
            kioskSlug: get().activeKioskSlug ?? undefined,
            joinToken: get().activeJoinToken ?? undefined,
          });

          // Increment visit count on savedPlaces
          if (ticket.office?.id) {
            const placeId = ticket.office.id;
            const places = get().savedPlaces;
            const existing = places.find((p) => p.id === placeId);
            if (existing) {
              set({
                savedPlaces: places.map((p) =>
                  p.id === placeId
                    ? { ...p, visitCount: p.visitCount + 1, lastSeenAt: new Date().toISOString() }
                    : p
                ),
              });
            }
          }
        }
        set({ activeToken: null, activeTicket: null, activeKioskSlug: null, activeJoinToken: null });
      },

      setCustomerInfo: (name, phone) => set({ customerName: name, customerPhone: phone }),
      setThemeMode: (mode) => set({ themeMode: mode }),

      recordPlace: (place) => {
        const places = get().savedPlaces;
        const existing = places.find((p) => p.id === place.id);
        const now = new Date().toISOString();
        if (existing) {
          set({
            savedPlaces: places.map((p) =>
              p.id === place.id
                ? {
                    ...p,
                    name: place.name,
                    address: place.address ?? p.address,
                    kioskSlug: place.kioskSlug ?? p.kioskSlug,
                    joinToken: place.joinToken ?? p.joinToken,
                    lastSeenAt: now,
                  }
                : p
            ),
          });
        } else {
          set({
            savedPlaces: [{ ...place, firstSeenAt: now, lastSeenAt: now, visitCount: 0 }, ...places],
          });
        }
      },

      removePlace: (id) => {
        set({ savedPlaces: get().savedPlaces.filter((p) => p.id !== id) });
      },
    }),
    {
      name: 'qflo-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeToken: state.activeToken,
        history: state.history,
        savedPlaces: state.savedPlaces,
        customerName: state.customerName,
        customerPhone: state.customerPhone,
        themeMode: state.themeMode,
      }),
    }
  )
);
