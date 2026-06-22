import { Tray, nativeImage, type NativeImage } from 'electron';
import { badgeText } from '../core/view-model';

export interface BeaconTray { setBadge(count: number): void; destroy(): void; }

export function createTray(opts: { iconPath: string; onToggle: () => void }): BeaconTray {
  const icon: NativeImage = nativeImage.createFromPath(opts.iconPath);
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('Beacon');
  tray.on('click', () => opts.onToggle()); // no context menu — it would suppress click on macOS
  return {
    setBadge: (count) => tray.setTitle(badgeText(count), { fontType: 'monospacedDigit' }),
    destroy: () => tray.destroy(),
  };
}
