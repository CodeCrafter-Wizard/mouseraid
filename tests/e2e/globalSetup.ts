import {
  FAKECAM_FOREIGN_SIZE,
  FAKECAM_FOREIGN_TEXT,
  FAKECAM_FOREIGN_Y4M_PATH,
  FAKECAM_SIZE,
  FAKECAM_Y4M_PATH,
  fakecamQrText,
  writeQrY4m,
} from '../../scripts/lib/qrY4m.mjs';

/**
 * Playwright ruft das EINMAL je Testlauf, vor dem ersten Browser-Start – genau richtig für
 * `--use-file-for-fake-video-capture`, denn das Flag wird beim Start gelesen. Zwei Bilder, weil das
 * Flag je Browser-Start gilt: der Payload-Code für `chromium-fakecam`, der FREMDE Code für
 * `chromium-fakecam-foreign`. Absichtlich ohne try/catch: ein stiller Fehlschlag machte die
 * Fake-Kamera-Smokes blind.
 */
export default function globalSetup(): void {
  writeQrY4m({ text: fakecamQrText(1100), ...FAKECAM_SIZE, path: FAKECAM_Y4M_PATH });
  writeQrY4m({ text: FAKECAM_FOREIGN_TEXT, ...FAKECAM_FOREIGN_SIZE, path: FAKECAM_FOREIGN_Y4M_PATH });
}
