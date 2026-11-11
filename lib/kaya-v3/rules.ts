/** Kaya V3: central, immutable business policy. Experimental branch only. */
export const KAYA_V3_RULES = Object.freeze({
  goals: ["inspection_appointment", "team_callback"] as const,
  noPriceQuotes: true,
  inspectionRequiredBeforeFinalOffer: true,
  inspectionFree: true,
  noHomeVisits: true,
  sundayClosed: true,
  onlyCars: true,
  noPoliticsOrReligion: true,
  respectStopAndSelfContact: true,
  neverConfirmUnpersistedAction: true,
  noInventedCustomerDetails: true,
  nonGccConfirmedStopsAutomaticBooking: true,
  allowUnknownSpecsToContinue: true,
  buyerEnquiriesToSalesTeam: true,
  humanHandoverOnRequest: true,
  neverRepeatIgnoredNameQuestion: true,
  timezone: "Asia/Dubai",
  bookingStart: "10:00",
  bookingEnd: "18:30",
} as const);
export type KayaV3Rule = keyof typeof KAYA_V3_RULES;
