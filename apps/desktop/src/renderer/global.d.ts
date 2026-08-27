import type { DesktopApiV1 } from '@app/contracts';

declare global {
  interface Window {
    desktop: DesktopApiV1;
  }
}

export {};
