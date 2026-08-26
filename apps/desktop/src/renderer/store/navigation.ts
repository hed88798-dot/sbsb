import { create } from 'zustand';

export type PageKey = 'dashboard' | 'products' | 'copywriting' | 'jobs' | 'settings';

interface NavigationState {
  page: PageKey;
  setPage(page: PageKey): void;
}

export const useNavigation = create<NavigationState>((set) => ({
  page: 'dashboard',
  setPage: (page) => set({ page }),
}));
