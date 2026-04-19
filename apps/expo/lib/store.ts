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
  /** Office timezone — used to format dates/times in the office's local clock. */
  officeTimezone?: string | null;
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
  /** @deprecated derived from history — kept for migration/back-compat only */
  visitCount: number;
  /** Organization logo URL, cached so Places can render it offline */
  logo_url?: string | null;
  /** True when the user pins this place; pinned places float to the top */
  isPinned?: boolean;
  /** Last time a queue-status fetch failed (e.g. link rotated) — ISO timestamp */
  lastFailedAt?: string | null;
  /** Last time we successfully fetched status — ISO timestamp */
  lastOkAt?: string | null;
  /** Business vertical/category, used for chip filter (e.g. 'clinic', 'barber') */
  vertical?: string | null;
  /** Cached list of lowercase service names, enables service-scoped search */
  services?: string[];
  /** Booking mode — 'disabled' | 'simple' | 'appointment' | 'hybrid' | 'advanced' etc. When not 'disabled' we expose a Book CTA. */
  bookingMode?: string | null;
  /** Wait-alert threshold — fire a local notification when waiting count drops to or below this; null = off */
  waitAlertThreshold?: number | null;
  /** Last time we fired a wait-alert for this place — to debounce noise */
  waitAlertLastFiredAt?: string | null;
  /** IANA timezone of the office (e.g. 'Africa/Algiers'). Used so that all
   *  times rendered on Places/ queue-peek reflect the office's local clock. */
  timezone?: string | null;
}

/** A booking the user has made, kept locally so we can list/cancel without a login.
 *  The `calendarToken` is the server-issued per-appointment access token — it's
 *  what authenticates self-service cancel/check-in with moderate-appointment,
 *  and it fetches the latest status via /api/calendar/[token]?format=json. */
export interface SavedAppointment {
  id: string;
  calendarToken: string;
  officeId: string;
  placeId?: string; // mirrors officeId; kept for future decoupling
  kioskSlug?: string | null;
  businessName: string;
  serviceName?: string | null;
  departmentName?: string | null;
  scheduledAt: string; // ISO
  status: string; // last-known status (pending|confirmed|cancelled|checked_in|completed|no_show)
  createdAt: string; // ISO — when the booking was made
  lastSyncedAt?: string; // ISO — last remote status refresh
  hidden?: boolean; // user dismissed from list after terminal status
  // Set once staff checks the customer in and a live ticket is issued.
  // Mobile uses these to render the ticket number on cards and to promote
  // the appointment to the Queue tab's live tracking view.
  ticketNumber?: string | null;
  ticketQrToken?: string | null;
  ticketStatus?: string | null;
  /** Office timezone — used when formatting scheduled_at for the customer. */
  officeTimezone?: string | null;
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
  /** Bookings the user has made from this device — source of truth for the "My appointments" screen. */
  savedAppointments: SavedAppointment[];
  customerName: string;
  customerPhone: string;
  themeMode: ThemeMode;

  setActiveToken: (token: string | null) => void;
  setActiveTicket: (ticket: TicketResponse | null) => void;
  setActiveKioskSlug: (slug: string | null) => void;
  setActiveJoinToken: (token: string | null) => void;
  addToHistory: (entry: HistoryEntry) => void;
  clearActiveTicket: (opts?: { terminalStatus?: string }) => void;
  setCustomerInfo: (name: string, phone: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  /** Called when a business is first encountered (QR scan, join link). Creates or updates savedPlaces entry. */
  recordPlace: (place: Omit<SavedPlace, 'firstSeenAt' | 'lastSeenAt' | 'visitCount'>) => void;
  /** Remove a business from saved places */
  removePlace: (id: string) => void;
  /** Toggle pinned state on a saved place */
  togglePinPlace: (id: string) => void;
  /** Set (or clear) the wait-alert threshold for a place */
  setWaitAlert: (id: string, threshold: number | null) => void;
  /** Stamp lastFailedAt on a place */
  markPlaceFailed: (id: string) => void;
  /** Stamp lastOkAt on a place */
  markPlaceOk: (id: string) => void;
  /** Record when we last fired a wait-alert for a place (debounce) */
  markWaitAlertFired: (id: string) => void;
  /** Update cached bookingMode on a saved place (from latest queue-status / kiosk-info) */
  setPlaceBookingMode: (id: string, mode: string | null) => void;

  /** Record a newly created booking (called after a successful createBooking response). */
  addAppointment: (appt: Omit<SavedAppointment, 'createdAt'> & { createdAt?: string }) => void;
  /** Patch a saved appointment (status refresh, hide, etc). */
  updateAppointment: (id: string, patch: Partial<SavedAppointment>) => void;
  /** Remove a saved appointment from the local list (does not touch the server). */
  removeAppointment: (id: string) => void;
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
      savedAppointments: [],
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

      clearActiveTicket: (opts) => {
        const ticket = get().activeTicket;
        if (ticket) {
          get().addToHistory({
            token: ticket.qr_token,
            ticketNumber: ticket.ticket_number,
            officeName: ticket.office?.name ?? 'Unknown',
            serviceName: ticket.service?.name ?? ticket.department?.name ?? 'General',
            // Let the caller stamp a terminal status (e.g. 'cancelled' after
            // the user taps "End visit"). Otherwise fall back to the ticket's
            // last known status so the history card still reflects reality.
            status: opts?.terminalStatus ?? ticket.status,
            date: new Date().toISOString(),
            officeId: ticket.office?.id,
            kioskSlug: get().activeKioskSlug ?? undefined,
            joinToken: get().activeJoinToken ?? undefined,
            officeTimezone: ticket.office?.timezone ?? null,
          });

          // Bump lastSeenAt on the place (visit count is derived from history)
          if (ticket.office?.id) {
            const placeId = ticket.office.id;
            const places = get().savedPlaces;
            const existing = places.find((p) => p.id === placeId);
            if (existing) {
              set({
                savedPlaces: places.map((p) =>
                  p.id === placeId
                    ? { ...p, lastSeenAt: new Date().toISOString() }
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
                    logo_url: place.logo_url ?? p.logo_url,
                    vertical: place.vertical ?? p.vertical,
                    services: place.services ?? p.services,
                    bookingMode: place.bookingMode ?? p.bookingMode,
                    lastSeenAt: now,
                    // Clear failure flag on a successful re-scan
                    lastFailedAt: null,
                    lastOkAt: now,
                  }
                : p
            ),
          });
        } else {
          set({
            savedPlaces: [
              {
                ...place,
                firstSeenAt: now,
                lastSeenAt: now,
                visitCount: 0,
                lastOkAt: now,
                isPinned: false,
                waitAlertThreshold: null,
              },
              ...places,
            ],
          });
        }
      },

      removePlace: (id) => {
        set({ savedPlaces: get().savedPlaces.filter((p) => p.id !== id) });
      },

      togglePinPlace: (id) => {
        set({
          savedPlaces: get().savedPlaces.map((p) =>
            p.id === id ? { ...p, isPinned: !p.isPinned } : p,
          ),
        });
      },

      setWaitAlert: (id, threshold) => {
        set({
          savedPlaces: get().savedPlaces.map((p) =>
            p.id === id
              ? {
                  ...p,
                  waitAlertThreshold: threshold,
                  // Reset debounce when user changes the threshold
                  waitAlertLastFiredAt: null,
                }
              : p,
          ),
        });
      },

      markPlaceFailed: (id) => {
        const now = new Date().toISOString();
        set({
          savedPlaces: get().savedPlaces.map((p) =>
            p.id === id ? { ...p, lastFailedAt: now } : p,
          ),
        });
      },

      markPlaceOk: (id) => {
        const now = new Date().toISOString();
        set({
          savedPlaces: get().savedPlaces.map((p) =>
            p.id === id ? { ...p, lastOkAt: now, lastFailedAt: null } : p,
          ),
        });
      },

      markWaitAlertFired: (id) => {
        const now = new Date().toISOString();
        set({
          savedPlaces: get().savedPlaces.map((p) =>
            p.id === id ? { ...p, waitAlertLastFiredAt: now } : p,
          ),
        });
      },

      setPlaceBookingMode: (id, mode) => {
        set({
          savedPlaces: get().savedPlaces.map((p) =>
            p.id === id ? { ...p, bookingMode: mode } : p,
          ),
        });
      },

      addAppointment: (appt) => {
        const now = new Date().toISOString();
        const existing = get().savedAppointments;
        // De-dupe by id — newest entry wins
        const filtered = existing.filter((a) => a.id !== appt.id);
        set({
          savedAppointments: [
            { createdAt: now, ...appt },
            ...filtered,
          ].slice(0, 100),
        });
      },

      updateAppointment: (id, patch) => {
        set({
          savedAppointments: get().savedAppointments.map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
        });
      },

      removeAppointment: (id) => {
        set({ savedAppointments: get().savedAppointments.filter((a) => a.id !== id) });
      },
    }),
    {
      name: 'qflo-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeToken: state.activeToken,
        history: state.history,
        savedPlaces: state.savedPlaces,
        savedAppointments: state.savedAppointments,
        customerName: state.customerName,
        customerPhone: state.customerPhone,
        themeMode: state.themeMode,
      }),
    }
  )
);
