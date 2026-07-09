import carPrices from "./carPrices";

// ── Standard depreciation (European/American brands) ───────────────────────────
// index = age in years, value = fraction of new price remaining
const DEPRECIATION: number[] = [
  1.00, // age 0
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

// ── High-retention depreciation (Japanese/Korean popular brands in UAE) ────────
// Toyota, Nissan, Honda, Mitsubishi, Hyundai, Kia hold value significantly
// better in the UAE — calibrated against Dubizzle listings (Jul 2026).
// RAV4 2020 GCC floor on Dubizzle = 63k → age-6 factor must produce low ≥ 63k.
const HIGH_RETENTION_DEPRECIATION: number[] = [
  1.00, // age 0
  0.90, // age 1
  0.85, // age 2
  0.82, // age 3
  0.80, // age 4
  0.78, // age 5
  0.75, // age 6  → RAV4 2020 GCC: ~AED 62,500–93,500 ✓
  0.70, // age 7
  0.65, // age 8
  0.60, // age 9
  0.55, // age 10
  0.50, // age 11
  0.45, // age 12
  0.40, // age 13
  0.36, // age 14
  0.32, // age 15
];

const HIGH_RETENTION_BRANDS = new Set([
  "Toyota", "Lexus", "Nissan", "Honda",
  "Mitsubishi", "Hyundai", "Kia", "Mazda", "Suzuki",
]);

function getDepreciationFactor(make: string, age: number): number {
  const table = HIGH_RETENTION_BRANDS.has(make)
    ? HIGH_RETENTION_DEPRECIATION
    : DEPRECIATION;

  if (age <= 0) return 1.0;
  if (age < table.length) return table[age];

  // Tail extrapolation past age 15
  const last = table[table.length - 1];
  const excess = age - (table.length - 1);
  return Math.max(0.05, last - excess * 0.016);
}

// Annual list-price inflation rate by brand.
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

// Brand multipliers — only needed for brands NOT in HIGH_RETENTION_BRANDS,
// since high-retention brands already have their own depreciation curve.
// High-retention brands default to 1.0 here.
const BRAND_MULTIPLIER: Record<string, number> = {
  "Porsche":       1.05,
  "BMW":           0.80,
  "Audi":          0.83,
  "Land Rover":    0.75,
  "LandRover":     0.75,
  "Jaguar":        0.75,
  "Maserati":      0.70,
  "Mercedes-Benz": 0.80,
};

// Model-specific overrides for extraordinary UAE demand.
const MODEL_MULTIPLIER: Record<string, Record<string, number>> = {
  "Nissan":  { "Patrol": 1.50 },
  "Toyota":  { "Land Cruiser": 1.40, "Land Cruiser Prado": 1.20 },
  "Lexus":   { "LX": 1.15 },
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
  make:       string,
  model:      string,
  yearStr:    string,
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

  // Depreciation — brand-aware table
  let factor = getDepreciationFactor(make, age);

  // Brand adjustment (no-op for high-retention brands — already in their table)
  factor *= (BRAND_MULTIPLIER[make] ?? 1.0);

  // Model-specific boost
  const modelBoost = MODEL_MULTIPLIER[make]?.[model];
  if (modelBoost) factor *= modelBoost;

  // Mileage adjustment: UAE average ~20,000 km/year
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

  // Non-GCC penalty
  if (specs === "Non-GCC") factor -= 0.10;

  factor = Math.max(0.03, factor);

  const mid  = adjustedBasePrice * factor;
  const low  = Math.round((mid * 0.80) / 500) * 500;
  const high = Math.round((mid * 1.20) / 500) * 500;

  return { baseNewPrice, low, high, formatted: `${fmtAED(low)} – ${fmtAED(high)}` };
}
