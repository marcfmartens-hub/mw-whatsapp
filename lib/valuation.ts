import carPrices from "./carPrices";

// UAE depreciation table — unified baseline for all brands (index = age in years)
const DEPRECIATION: number[] = [
  1.00, // age 0  (new)
  0.75, // age 1
  0.65, // age 2
  0.55, // age 3
  0.48, // age 4
  0.40, // age 5
  0.34, // age 6
  0.29, // age 7
  0.25, // age 8
  0.21, // age 9
  0.18, // age 10
  0.16, // age 11
  0.14, // age 12
  0.12, // age 13
  0.10, // age 14
  0.08, // age 15
  0.07, // age 16
  0.06, // age 17
  0.05, // age 18
  0.04, // age 19
  0.03, // age 20+ (floor)
];

function getDepreciationFactor(age: number): number {
  if (age <= 0) return 1.0;
  if (age <= 20) return DEPRECIATION[age];
  return 0.03;
}

// Annual list-price inflation rate by brand.
// Premium brands have risen faster — deflates current list price back to what
// the car cost new at the time of purchase.
const PRICE_INFLATION_RATE: Record<string, number> = {
  "BMW":           0.955,
  "Mercedes-Benz": 0.955,
  "Audi":          0.960,
  "Land Rover":    0.955,
  "LandRover":     0.955,
  "Jaguar":        0.960,
  "Porsche":       0.960,
  "Maserati":      0.965,
  "Bentley":       0.970,
};
const DEFAULT_INFLATION_RATE = 0.985;

// Brand value-retention multipliers applied on top of the base depreciation table.
// Japanese/Korean mass-market brands hold value better than average in UAE.
// European/luxury brands depreciate faster than average.
const BRAND_MULTIPLIER: Record<string, number> = {
  "Toyota":        1.15,
  "Lexus":         1.15,
  "Nissan":        1.05,
  "Honda":         1.05,
  "Mitsubishi":    1.00,
  "Hyundai":       1.00,
  "Kia":           1.00,
  "Porsche":       1.05,
  "BMW":           0.80,
  "Audi":          0.83,
  "Land Rover":    0.75,
  "LandRover":     0.75,
  "Jaguar":        0.75,
  "Maserati":      0.70,
  "Mercedes-Benz": 0.80,
};

// Model-specific multipliers for UAE demand outliers.
const MODEL_MULTIPLIER: Record<string, Record<string, number>> = {
  "Nissan": { "Patrol": 1.65 },
  "Toyota": { "Land Cruiser": 1.40, "Land Cruiser Prado": 1.20 },
  "Lexus":  { "LX": 1.20 },
};

const MAKE_KEY_MAP: Record<string, string> = {
  "Land Rover": "LandRover",
};

export interface ValuationResult {
  baseNewPrice: number;
  low:  number;
  high: number;
  formatted: string;
}

function fmtAED(n: number): string {
  return "AED " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function estimateCarValue(
  make:        string,
  model:       string,
  yearStr:     string,
  mileageStr?: string | null,
  specs?:      string | null,
): ValuationResult | null {
  const priceKey  = MAKE_KEY_MAP[make] ?? make;
  const makeData  = carPrices[priceKey];
  if (!makeData) return null;
  const modelData = makeData[model];
  if (!modelData?.trims?.length) return null;

  const baseNewPrice = modelData.trims[0].price;
  const carYear      = parseInt(yearStr, 10);
  if (isNaN(carYear)) return null;

  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - carYear);

  // Deflate current list price back to purchase-year equivalent
  const inflationRate     = PRICE_INFLATION_RATE[make] ?? DEFAULT_INFLATION_RATE;
  const adjustedBasePrice = baseNewPrice * Math.pow(inflationRate, age);

  let factor = getDepreciationFactor(age);
  factor *= (BRAND_MULTIPLIER[make] ?? 1.0);

  const modelBoost = MODEL_MULTIPLIER[make]?.[model];
  if (modelBoost) factor *= modelBoost;

  // Mileage: UAE average 15–20k km/year; >20k considered high
  if (mileageStr) {
    const actualKm   = parseInt(mileageStr.replace(/[^0-9]/g, ""), 10);
    const expectedKm = age * 20000;
    if (!isNaN(actualKm) && expectedKm > 0) {
      const ratio = actualKm / expectedKm;
      if      (ratio > 2.0) factor -= 0.15;
      else if (ratio > 1.5) factor -= 0.10;
      else if (ratio > 1.2) factor -= 0.05;
      else if (ratio < 0.6) factor += 0.05;
    }
  }

  if (specs === "Non-GCC") factor -= 0.10;

  factor = Math.max(0.03, factor);

  const mid  = adjustedBasePrice * factor;
  const low  = Math.round((mid * 0.80) / 500) * 500;
  const high = Math.round((mid * 1.20) / 500) * 500;

  return { baseNewPrice, low, high, formatted: `${fmtAED(low)} – ${fmtAED(high)}` };
}
