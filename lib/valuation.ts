import carPrices from "./carPrices";

// UAE depreciation table: index = age in years (1-based), value = fraction of new price remaining
const DEPRECIATION: number[] = [
  1.00, // age 0 (new)
  0.75, // age 1
  0.65, // age 2
  0.55, // age 3
  0.48, // age 4
  0.42, // age 5
  0.37, // age 6
  0.33, // age 7
  0.29, // age 8
  0.26, // age 9
  0.23, // age 10
  0.21, // age 11
  0.19, // age 12
  0.17, // age 13
  0.15, // age 14
  0.13, // age 15
];

function getDepreciationFactor(age: number): number {
  if (age <= 0) return 1.0;
  if (age <= 15) return DEPRECIATION[age];
  if (age <= 20) return Math.max(0.05, 0.13 - (age - 15) * 0.016);
  return Math.max(0.03, 0.05 - (age - 20) * 0.004);
}

// Brand multipliers applied on top of base depreciation
// Toyota/Lexus/Patrol hold better; BMW/MB/LR depreciate faster
const BRAND_MULTIPLIER: Record<string, number> = {
  "Toyota":        1.12,
  "Lexus":         1.15,
  "Nissan":        1.05,  // Patrol pulls the average up
  "Honda":         1.05,
  "Porsche":       1.08,
  "BMW":           0.85,
  "Audi":          0.88,
  "Land Rover":    0.80,
  "LandRover":     0.80,
  "Jaguar":        0.80,
  "Maserati":      0.75,
  "Mercedes-Benz": 0.85,
};

// Normalise stored make names to carPrices keys
const MAKE_KEY_MAP: Record<string, string> = {
  "Land Rover":    "LandRover",
  "Mercedes-Benz": "Mercedes-Benz", // same
};

export interface ValuationResult {
  baseNewPrice: number; // lowest trim new price used
  low:  number;
  high: number;
  formatted: string; // "AED 15,000 – 18,000"
}

function fmtAED(n: number): string {
  return "AED " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function estimateCarValue(
  make:       string,
  model:      string,
  yearStr:    string,
  mileageStr?: string | null,
  specs?:      string | null,
): ValuationResult | null {
  // Resolve make key used in carPrices
  const priceKey = MAKE_KEY_MAP[make] ?? make;
  const makeData  = carPrices[priceKey];
  if (!makeData) return null;
  const modelData = makeData[model];
  if (!modelData?.trims?.length) return null;

  const baseNewPrice = modelData.trims[0].price;
  const carYear      = parseInt(yearStr, 10);
  if (isNaN(carYear)) return null;

  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - carYear);

  // Base depreciation
  let factor = getDepreciationFactor(age);

  // Brand adjustment
  factor *= (BRAND_MULTIPLIER[make] ?? 1.0);

  // Mileage adjustment: UAE average ~20,000 km/year
  if (mileageStr) {
    const actualKm   = parseInt(mileageStr.replace(/[^0-9]/g, ""), 10);
    const expectedKm = age * 20000;
    if (!isNaN(actualKm) && expectedKm > 0) {
      const ratio = actualKm / expectedKm;
      if      (ratio > 2.0) factor -= 0.15;
      else if (ratio > 1.5) factor -= 0.10;
      else if (ratio > 1.2) factor -= 0.05;
      else if (ratio < 0.6) factor += 0.05; // low mileage premium
    }
  }

  // Specs adjustment
  if (specs === "Non-GCC") factor -= 0.10;

  factor = Math.max(0.03, factor);

  const mid  = baseNewPrice * factor;
  const low  = Math.round((mid * 0.88) / 500)  * 500;
  const high = Math.round((mid * 1.12) / 500)  * 500;

  return {
    baseNewPrice,
    low,
    high,
    formatted: `${fmtAED(low)} – ${fmtAED(high)}`,
  };
}
