import { chromiumAnswer } from './chromium-answer';
import { chromiumOffer } from './chromium-offer';
import { firefoxAnswer } from './firefox-answer';
import { firefoxOffer } from './firefox-offer';
import { safariOfferSynthetic } from './safari-offer-synthetisch';

export interface SdpFixture {
  name: string;
  role: 'offer' | 'answer';
  sdp: string;
  /** Erwartete Kandidatenzahl – fällt auf, wenn eine Fixture still Zeilen verliert. */
  candidates: number;
}

export const SDP_FIXTURES: readonly SdpFixture[] = [
  { name: 'chromium-offer', role: 'offer', sdp: chromiumOffer, candidates: 4 },
  { name: 'chromium-answer', role: 'answer', sdp: chromiumAnswer, candidates: 2 },
  { name: 'firefox-offer', role: 'offer', sdp: firefoxOffer, candidates: 4 },
  { name: 'firefox-answer', role: 'answer', sdp: firefoxAnswer, candidates: 2 },
  { name: 'safari-offer-synthetisch', role: 'offer', sdp: safariOfferSynthetic, candidates: 1 },
];
