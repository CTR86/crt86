import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  effects: boolean
  sound: boolean
  night: boolean
  booted: boolean
  setEffects: (v: boolean) => void
  setSound: (v: boolean) => void
  setNight: (v: boolean) => void
  markBooted: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      effects: true,
      sound: true,
      night: false,
      booted: false,
      setEffects: (v) => set({ effects: v }),
      setSound: (v) => set({ sound: v }),
      setNight: (v) => set({ night: v }),
      markBooted: () => set({ booted: true }),
    }),
    {
      name: 'crt86-settings',
      version: 1,
      // v1: sound is ON by default for everyone (one-time flip on old profiles)
      migrate: (persisted) => ({ ...(persisted as object), sound: true }),
    },
  ),
)
