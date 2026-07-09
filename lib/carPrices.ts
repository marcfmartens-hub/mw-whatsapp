// UAE new car prices (AED) scraped from Drivearabia.com
// Year shown is 2026 where available, otherwise 2025

export interface TrimPrice {
  trim: string;
  display: string;
  price: number; // starting price in AED
}

export interface ModelPrices {
  year: number;
  trims: TrimPrice[];
}

export type CarPrices = Record<string, Record<string, ModelPrices>>;

const carPrices: CarPrices = {
  Audi: {
    "A6": {
      year: 2025,
      trims: [
        { trim: "2.0TC+H I4 45 TFSI FWD", display: "AED 199,500 - 200,000", price: 199500 },
        { trim: "2.0TC+H I4 45 TFSI Quattro 4WD", display: "AED 234,045 - 255,000", price: 234045 },
      ],
    },
    "A8": {
      year: 2026,
      trims: [
        { trim: "4.0TC V8 60 TFSI Quattro LWB 4WD", display: "AED 380,000 - 450,000", price: 380000 },
        { trim: "3.0TC V6 55 TFSI Quattro LWB 4WD", display: "AED 385,000 - 390,000", price: 385000 },
      ],
    },
    "Q3": {
      year: 2026,
      trims: [
        { trim: "1.4TC I4 S-Line 35 TFSI FWD", display: "AED 185,000 - 188,000", price: 185000 },
        { trim: "2.0TC I4 S-Line 45 TFSI 4WD", display: "AED 200,000 - 210,000", price: 200000 },
      ],
    },
    "Q5": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 40 TFSI Sportback 4WD", display: "AED 329,900 - 350,000", price: 329900 },
      ],
    },
    "Q7": {
      year: 2026,
      trims: [
        { trim: "3.0TC+E V6 55 TFSI 4WD", display: "AED 400,000 - 415,000", price: 400000 },
      ],
    },
  },
  BMW: {
    "2 Series": {
      year: 2026,
      trims: [{ trim: "3.0TC I6 M240i 4WD", display: "AED 280,000 - 300,000", price: 280000 }],
    },
    "3 Series": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 330i RWD", display: "AED 199,000 - 235,000", price: 199000 }],
    },
    "4 Series": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 430i RWD", display: "AED 270,000 - 275,000", price: 270000 },
        { trim: "3.0TC I6 M 440i 4WD", display: "AED 320,000 - 330,000", price: 320000 },
      ],
    },
    "5 Series": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 530i RWD", display: "AED 350,000 - 380,000", price: 350000 }],
    },
    "7 Series": {
      year: 2026,
      trims: [
        { trim: "3.0TC+E I6 740i sDrive RWD", display: "AED 585,000 - 590,000", price: 585000 },
        { trim: "4.4TC+E V8 760i xDrive 4WD", display: "AED 675,000 - 680,000", price: 675000 },
      ],
    },
    "8 Series": {
      year: 2025,
      trims: [{ trim: "4.4TC V8 850i xDrive", display: "AED 550,000 - 560,000", price: 550000 }],
    },
    "X1": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 xDrive25i", display: "AED 223,100 - 250,000", price: 223100 }],
    },
    "X2": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 M35i 4WD", display: "AED 250,000 - 255,000", price: 250000 }],
    },
    "X3": {
      year: 2026,
      trims: [{ trim: "3.0TC I6 M50 xDrive 4WD", display: "AED 384,000 - 394,000", price: 384000 }],
    },
    "X5": {
      year: 2026,
      trims: [
        { trim: "4.4TC V8 xDrive50i", display: "AED 440,000 - 450,000", price: 440000 },
        { trim: "4.4TC V8 M50i", display: "AED 500,000 - 520,000", price: 500000 },
      ],
    },
    "X6": {
      year: 2026,
      trims: [{ trim: "4.4TC V8 xDrive50i 4WD", display: "AED 460,000 - 462,000", price: 460000 }],
    },
    "X7": {
      year: 2026,
      trims: [{ trim: "4.4TC+E V8 M60i", display: "AED 600,000 - 610,000", price: 600000 }],
    },
    "Z4": {
      year: 2025,
      trims: [
        { trim: "2.0TC I4 sDrive 30i RWD", display: "AED 250,000 - 270,000", price: 250000 },
        { trim: "3.0TC I6 M40i RWD", display: "AED 300,000 - 310,000", price: 300000 },
      ],
    },
    "iX": {
      year: 2026,
      trims: [{ trim: "105 kWh iX xDrive50 AWD", display: "AED 510,000 - 521,000", price: 510000 }],
    },
  },
  BYD: {
    "Han": {
      year: 2025,
      trims: [{ trim: "85.4 kWh Platinum 4WD", display: "AED 231,900 - 232,000", price: 231900 }],
    },
    "Seal": {
      year: 2026,
      trims: [
        { trim: "82.5 kWh Premium FWD", display: "AED 164,900 - 174,900", price: 164900 },
        { trim: "82.5 kWh Performance AWD", display: "AED 194,900 - 204,900", price: 194900 },
      ],
    },
  },
  Bentley: {
    "Bentayga": {
      year: 2026,
      trims: [{ trim: "6.0TC W12 Bentayga Speed 4WD", display: "AED 955,000 - 2,000,000", price: 955000 }],
    },
    "Continental GT": {
      year: 2026,
      trims: [{ trim: "6.0TC W12 Continental GT Speed", display: "AED 900,000 - 1,100,000", price: 900000 }],
    },
    "Flying Spur": {
      year: 2026,
      trims: [
        { trim: "4.0TC V8 Flying Spur Azure", display: "AED 1,000,000 - 1,100,000", price: 1000000 },
        { trim: "6.0TC W12 Flying Spur Speed", display: "AED 1,069,000 - 1,200,000", price: 1069000 },
        { trim: "6.0TC W12 Flying Spur Mulliner", display: "AED 1,300,000 - 1,400,000", price: 1300000 },
      ],
    },
  },
  Cadillac: {
    "CT5": {
      year: 2026,
      trims: [{ trim: "3.0T Sport", display: "AED 260,000 - 270,000", price: 260000 }],
    },
    "Escalade": {
      year: 2026,
      trims: [{ trim: "6.2 V8 Sport Platinum", display: "AED 543,000 - 546,000", price: 543000 }],
    },
    "XT4": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 Sport", display: "AED 191,900 - 200,000", price: 191900 }],
    },
    "XT5": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 Premium Luxury 4WD", display: "AED 202,700 - 203,000", price: 202700 },
        { trim: "3.6 V6 Sport 4WD", display: "AED 220,100 - 221,000", price: 220100 },
      ],
    },
    "XT6": {
      year: 2026,
      trims: [
        { trim: "3.6 V6 Premium luxury", display: "AED 255,000 - 280,000", price: 255000 },
        { trim: "3.6 V6 Sport", display: "AED 285,000 - 290,000", price: 285000 },
      ],
    },
  },
  Changan: {
    "UNI-T": {
      year: 2025,
      trims: [{ trim: "1.5TC I4 Sport", display: "AED 115,000 - 116,000", price: 115000 }],
    },
  },
  Chevrolet: {
    "Blazer": {
      year: 2026,
      trims: [
        { trim: "3.6 V6 Blazer RS AWD", display: "AED 191,000 - 192,000", price: 191000 },
        { trim: "3.6 V6 Blazer Premier AWD", display: "AED 192,500 - 193,000", price: 192500 },
      ],
    },
    "Corvette": {
      year: 2026,
      trims: [
        { trim: "6.2 V8 2LT Convertible RWD", display: "AED 418,800 - 420,000", price: 418800 },
        { trim: "6.2 V8 3LT Coupe RWD", display: "AED 500,000 - 510,000", price: 500000 },
        { trim: "e-Ray RWD", display: "AED 695,000 - 700,000", price: 695000 },
        { trim: "Z06 RWD", display: "AED 765,000 - 780,000", price: 765000 },
      ],
    },
    "Silverado": {
      year: 2025,
      trims: [
        { trim: "2.7TC I4 LT", display: "AED 146,200 - 147,000", price: 146200 },
        { trim: "5.3 V8 Trailboss", display: "AED 167,400 - 168,000", price: 167400 },
        { trim: "6.2 V8 ZR2", display: "AED 227,300 - 228,000", price: 227300 },
        { trim: "6.2 V8 High Country", display: "AED 239,900 - 240,000", price: 239900 },
      ],
    },
    "Suburban": {
      year: 2026,
      trims: [
        { trim: "5.3 V8 Suburban LT", display: "AED 285,000 - 290,000", price: 285000 },
        { trim: "5.3 V8 Suburban Premier", display: "AED 324,000 - 325,000", price: 324000 },
        { trim: "6.2 V8 Suburban Premier", display: "AED 330,000 - 310,000", price: 330000 },
      ],
    },
    "Tahoe": {
      year: 2025,
      trims: [
        { trim: "5.3 V8 Z71 4WD", display: "AED 275,000 - 284,000", price: 275000 },
        { trim: "5.3 V8 RST 4WD", display: "AED 287,000 - 294,000", price: 287000 },
        { trim: "6.2 V8 Premier 4WD", display: "AED 302,000 - 310,000", price: 302000 },
      ],
    },
    "Traverse": {
      year: 2026,
      trims: [{ trim: "2.5TC I4 Z71 4WD", display: "AED 214,000 - 216,000", price: 214000 }],
    },
  },
  "Citroën": {
    "C3 Aircross": {
      year: 2025,
      trims: [{ trim: "1.2TC I3 Shine FWD", display: "AED 82,000 - 83,000", price: 82000 }],
    },
    "C4": {
      year: 2026,
      trims: [
        { trim: "1.2TC I3 Feel Pack FWD", display: "AED 79,900 - 80,000", price: 79900 },
        { trim: "1.2TC I3 Shine FWD", display: "AED 85,000 - 90,000", price: 85000 },
      ],
    },
    "C5 Aircross": {
      year: 2026,
      trims: [
        { trim: "1.6TC I4 C5 Feel", display: "AED 122,000 - 130,000", price: 122000 },
        { trim: "1.6TC I4 C5 Shine", display: "AED 133,000 - 140,000", price: 133000 },
      ],
    },
  },
  Fiat: {
    "500": {
      year: 2025,
      trims: [
        { trim: "1.4 I4 Lounge Convertible FWD", display: "AED 78,000 - 80,000", price: 78000 },
        { trim: "1.4 I4 Dolcevita FWD", display: "AED 85,000 - 86,000", price: 85000 },
      ],
    },
  },
  Ford: {
    "Bronco": {
      year: 2026,
      trims: [
        { trim: "2.7TC Outer Banks 4WD", display: "AED 256,095 - 256,100", price: 256095 },
        { trim: "2.7TC WildTrak 4WD", display: "AED 273,945 - 274,000", price: 273945 },
        { trim: "2.7TC Badlands 4WD", display: "AED 283,395 - 284,000", price: 283395 },
      ],
    },
    "Expedition": {
      year: 2026,
      trims: [
        { trim: "3.5TC V6 Timberline 4WD", display: "AED 316,995 - 326,995", price: 316995 },
        { trim: "3.5TC V6 Stealth 4WD", display: "AED 333,995 - 343,995", price: 333995 },
        { trim: "3.5TC V6 Platinum 4WD", display: "AED 344,995 - 354,995", price: 344995 },
      ],
    },
    "Explorer": {
      year: 2026,
      trims: [
        { trim: "2.3TC I4 Platinum 4WD", display: "AED 227,745 - 228,000", price: 227745 },
        { trim: "3.0TC V6 ST 4WD", display: "AED 245,595 - 246,000", price: 245595 },
      ],
    },
    "F-150": {
      year: 2026,
      trims: [
        { trim: "3.5TC V6 Lariat 4WD", display: "AED 255,000 - 256,000", price: 255000 },
        { trim: "3.5 HEV V6 Lariat 4WD", display: "AED 267,645 - 268,000", price: 267645 },
        { trim: "3.5 HEV V6 Platinum 4WD", display: "AED 284,500 - 285,000", price: 284500 },
        { trim: "3.5 HEV V6 Limited 4WD", display: "AED 287,600 - 288,000", price: 287600 },
        { trim: "3.5TC V6 Tremor 4WD", display: "AED 300,000 - 301,000", price: 300000 },
      ],
    },
    "Mustang": {
      year: 2026,
      trims: [
        { trim: "5.0L V8 GT Premium RWD", display: "AED 256,095 - 260,000", price: 256095 },
        { trim: "5.0 V8 Dark Horse RWD", display: "AED 290,000 - 291,000", price: 290000 },
      ],
    },
    "Ranger": {
      year: 2026,
      trims: [
        { trim: "2.0TD I4 XLT 4WD", display: "AED 166,845 - 173,000", price: 166845 },
        { trim: "2.3TC I4 WildTrack 4WD", display: "AED 193,100 - 195,000", price: 193100 },
      ],
    },
  },
  GMC: {
    "Acadia": {
      year: 2026,
      trims: [{ trim: "3.6L V6 Denali 4WD", display: "AED 231,000 - 232,000", price: 231000 }],
    },
    "Terrain": {
      year: 2026,
      trims: [{ trim: "Denali", display: "AED 157,000 - 165,000", price: 157000 }],
    },
    "Yukon": {
      year: 2025,
      trims: [{ trim: "6.2L V8 Denali 4WD", display: "AED 375,000 - 380,000", price: 375000 }],
    },
  },
  Geely: {
    "Coolray": {
      year: 2026,
      trims: [
        { trim: "1.5TC I4 GK FWD", display: "AED 80,500 - 81,500", price: 80500 },
        { trim: "1.5TC I4 GF FWD", display: "AED 86,900 - 87,900", price: 86900 },
        { trim: "1.5TC I4 GF+ FWD", display: "AED 88,900 - 89,900", price: 88900 },
      ],
    },
    "Emgrand": {
      year: 2026,
      trims: [{ trim: "1.5 I4 GK FWD", display: "AED 68,000 - 69,000", price: 68000 }],
    },
    "Okavango": {
      year: 2025,
      trims: [{ trim: "2.0TC I4 GF FWD", display: "AED 105,000 - 106,000", price: 105000 }],
    },
    "Tugella": {
      year: 2025,
      trims: [
        { trim: "2.0TC I4 GF 4WD", display: "AED 113,900 - 114,000", price: 113900 },
        { trim: "2.0TC I4 GF+ 4WD", display: "AED 128,900 - 129,000", price: 128900 },
      ],
    },
  },
  Genesis: {
    "G70": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 Royal RWD", display: "AED 196,000 - 197,000", price: 196000 },
        { trim: "3.3TC V6 Premium RWD", display: "AED 204,900 - 205,000", price: 204900 },
        { trim: "3.3TC V6 Royal RWD", display: "AED 215,000 - 216,000", price: 215000 },
      ],
    },
    "G80": {
      year: 2026,
      trims: [
        { trim: "3.5TC V6 Prestige 2WD", display: "AED 262,000 - 265,000", price: 262000 },
        { trim: "3.5TC V6 Royal 4WD", display: "AED 293,000 - 295,000", price: 293000 },
      ],
    },
    "GV70": {
      year: 2026,
      trims: [
        { trim: "2.5TC I4 Prestige Plus 4WD", display: "AED 230,000 - 232,000", price: 230000 },
        { trim: "2.5TC I4 Premium 4WD", display: "AED 239,000 - 245,000", price: 239000 },
        { trim: "2.5TC I4 Platinum Sport 4WD", display: "AED 255,000 - 260,000", price: 255000 },
        { trim: "3.5TC V6 Royal 4WD", display: "AED 272,500 - 275,000", price: 272500 },
      ],
    },
    "GV80": {
      year: 2026,
      trims: [
        { trim: "2.5TC I4 Premium 4WD", display: "AED 330,000 - 332,000", price: 330000 },
        { trim: "3.5TC V6 Premium 4WD", display: "AED 350,000 - 355,000", price: 350000 },
        { trim: "3.5TC V6 Royal 4WD", display: "AED 365,000 - 368,000", price: 365000 },
      ],
    },
  },
  Haval: {
    "H6": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 Supreme 4WD", display: "AED 101,700 - 111,700", price: 101700 }],
    },
    "H9": {
      year: 2025,
      trims: [{ trim: "2.0TC I4 Dignity 4WD", display: "AED 129,900 - 130,000", price: 129900 }],
    },
    "Jolion": {
      year: 2026,
      trims: [
        { trim: "1.5TC I4 Top FWD", display: "AED 84,900 - 85,000", price: 84900 },
        { trim: "1.5TC I4 High Deluxe FWD", display: "AED 94,900 - 95,000", price: 94900 },
      ],
    },
  },
  Honda: {
    "Accord": {
      year: 2026,
      trims: [
        { trim: "1.5TC I4 EX", display: "AED 124,900 - 125,000", price: 124900 },
        { trim: "1.5TC I4 EX-L", display: "AED 139,900 - 140,000", price: 139900 },
        { trim: "2.0H I4 e:HEV Sport FWD", display: "AED 154,900 - 156,000", price: 154900 },
        { trim: "2.0H I4 e:HEV EX-L FWD", display: "AED 165,900 - 166,000", price: 165900 },
      ],
    },
    "CR-V": {
      year: 2026,
      trims: [
        { trim: "1.5TC I4 EX 4WD", display: "AED 149,900 - 150,000", price: 149900 },
        { trim: "1.5TC I4 Touring 4WD", display: "AED 164,900 - 165,000", price: 164900 },
      ],
    },
    "City": {
      year: 2026,
      trims: [{ trim: "1.5L I4 LX Sport FWD", display: "AED 75,900 - 76,000", price: 75900 }],
    },
    "Civic": {
      year: 2026,
      trims: [{ trim: "1.5TC I4 Sport FWD", display: "AED 129,000 - 130,000", price: 129000 }],
    },
    "HR-V": {
      year: 2026,
      trims: [{ trim: "1.5L I4 EX FWD", display: "AED 104,150 - 105,000", price: 104150 }],
    },
    "Pilot": {
      year: 2026,
      trims: [
        { trim: "Sport AWD", display: "AED 199,900 - 200,000", price: 199900 },
        { trim: "EX-L AWD", display: "AED 212,900 - 215,000", price: 212900 },
      ],
    },
  },
  Hyundai: {
    "Accent": {
      year: 2026,
      trims: [{ trim: "1.5 I4 Smart FWD", display: "AED 82,000 - 83,000", price: 82000 }],
    },
    "Elantra": {
      year: 2026,
      trims: [
        { trim: "1.6L I4 TOP FWD", display: "AED 78,000 - 80,000", price: 78000 },
        { trim: "2.0L I4 TOP FWD", display: "AED 87,000 - 90,000", price: 87000 },
      ],
    },
    "Kona": {
      year: 2026,
      trims: [
        { trim: "2.0L Comfort", display: "AED 70,000 - 71,000", price: 70000 },
        { trim: "1.6T Smart", display: "AED 71,000 - 72,000", price: 71000 },
        { trim: "2.0L Premium", display: "AED 80,000 - 80,500", price: 80000 },
        { trim: "1.6T Sport", display: "AED 92,000 - 92,500", price: 92000 },
      ],
    },
    "Palisade": {
      year: 2026,
      trims: [{ trim: "3.8 V6 Premium 4WD", display: "AED 210,000 - 213,000", price: 210000 }],
    },
    "Santa Fe": {
      year: 2026,
      trims: [
        { trim: "2.5TC I4 4WD", display: "AED 149,000 - 155,000", price: 149000 },
        { trim: "2.5TC I4 Premium 4WD", display: "AED 180,000 - 185,000", price: 180000 },
        { trim: "2.5TC I4 Calligraphy 4WD", display: "AED 192,000 - 193,000", price: 192000 },
      ],
    },
    "Sonata": {
      year: 2026,
      trims: [
        { trim: "2.5L I4 Comfort FWD", display: "AED 124,500 - 125,000", price: 124500 },
        { trim: "2.5L I4 Premium FWD", display: "AED 146,500 - 147,500", price: 146500 },
      ],
    },
    "Staria": {
      year: 2026,
      trims: [
        { trim: "3.5 V6 5-seater Van", display: "AED 104,900 - 105,000", price: 104900 },
        { trim: "3.5 V6 9-seater Comfort", display: "AED 114,900 - 115,000", price: 114900 },
        { trim: "3.5 V6 11-seater Comfort", display: "AED 116,900 - 117,000", price: 116900 },
        { trim: "3.5 V6 9-seater Premium", display: "AED 149,900 - 150,000", price: 149900 },
        { trim: "3.5 V6 7-seater Luxury", display: "AED 169,900 - 170,000", price: 169900 },
      ],
    },
    "Tucson": {
      year: 2026,
      trims: [
        { trim: "2.0 I4 FWD Comfort", display: "AED 106,800 - 116,000", price: 106800 },
        { trim: "2.0 I4 FWD Premium", display: "AED 108,400 - 119,200", price: 108400 },
        { trim: "1.6TC I4 4WD Premium", display: "AED 125,000 - 136,700", price: 125000 },
      ],
    },
  },
  Infiniti: {
    "QX50": {
      year: 2025,
      trims: [
        { trim: "2.0TC I4 Style AWD", display: "AED 200,000 - 191,000", price: 200000 },
        { trim: "2.0TC I4 Sport AWD", display: "AED 227,000 - 228,000", price: 227000 },
        { trim: "2.0TC I4 Autograph AWD", display: "AED 237,000 - 238,000", price: 237000 },
      ],
    },
    "QX55": {
      year: 2025,
      trims: [
        { trim: "2.0T I4 Essential AWD", display: "AED 224,000 - 225,000", price: 224000 },
        { trim: "2.0T I4 Sensory AWD", display: "AED 238,000 - 239,000", price: 238000 },
      ],
    },
    "QX60": {
      year: 2025,
      trims: [
        { trim: "3.5 V6 Luxe with Climate Package 4WD", display: "AED 262,500 - 272,500", price: 262500 },
        { trim: "3.5 V6 Sensory 4WD", display: "AED 282,000 - 292,000", price: 282000 },
        { trim: "3.5 V6 Autograph 4WD", display: "AED 302,500 - 312,500", price: 302500 },
      ],
    },
    "QX80": {
      year: 2025,
      trims: [{ trim: "3.5TC V6 Autograph 4WD", display: "AED 510,000 - 512,000", price: 510000 }],
    },
  },
  Isuzu: {
    "D-Max": {
      year: 2026,
      trims: [
        { trim: "D-Max 3.0 Flatbed 2WD", display: "AED 71,000 - 71,500", price: 71000 },
        { trim: "1.9 D-Max 4WD", display: "AED 75,000 - 76,000", price: 75000 },
        { trim: "D-Max 3.0 Double Cab 2WD", display: "AED 77,000 - 78,000", price: 77000 },
        { trim: "D-Max 3.0 Crew Cab 4WD LS", display: "AED 105,000 - 106,000", price: 105000 },
        { trim: "D-Max 3.0 Crew Cab 4WD GT", display: "AED 110,250 - 111,000", price: 110250 },
      ],
    },
  },
  Jaguar: {
    "F-Pace": {
      year: 2025,
      trims: [
        { trim: "2.0TC I4 R-Dynamic SE 4WD", display: "AED 278,355 - 285,000", price: 278355 },
        { trim: "2.0TC I4 R-Dynamic HSE 4WD", display: "AED 317,100 - 320,000", price: 317100 },
        { trim: "3.0TC V6 400 Sport 4WD", display: "AED 360,780 - 365,000", price: 360780 },
        { trim: "5.0SC V8 SVR 575 Edition 4WD", display: "AED 448,455 - 450,000", price: 448455 },
      ],
    },
  },
  Jeep: {
    "Gladiator": {
      year: 2025,
      trims: [{ trim: "3.6 V6 Sand Runner 4WD", display: "AED 254,900 - 255,000", price: 254900 }],
    },
    "Grand Cherokee": {
      year: 2026,
      trims: [{ trim: "3.6 V6 Summit Reserve 4WD", display: "AED 280,000 - 281,000", price: 280000 }],
    },
    "Grand Cherokee L": {
      year: 2026,
      trims: [{ trim: "5.7L V8 Summit Reserve 4WD", display: "AED 335,000 - 300,000", price: 335000 }],
    },
    "Wrangler": {
      year: 2026,
      trims: [
        { trim: "Sahara", display: "AED 220,000 - 225,000", price: 220000 },
        { trim: "Rubicon", display: "AED 265,900 - 268,000", price: 265900 },
      ],
    },
    "Wrangler Unlimited": {
      year: 2026,
      trims: [
        { trim: "Sahara", display: "AED 260,000 - 261,000", price: 260000 },
        { trim: "Rubicon", display: "AED 290,000 - 291,000", price: 290000 },
      ],
    },
  },
  Jetour: {
    "T2": {
      year: 2025,
      trims: [{ trim: "1.5TC+E i-DM Hybrid FWD", display: "AED 167,000 - 168,000", price: 167000 }],
    },
  },
  Kia: {
    "K5": {
      year: 2026,
      trims: [
        { trim: "2.0L I4 LX FWD", display: "AED 85,000 - 86,000", price: 85000 },
        { trim: "2.5L I4 standard FWD", display: "AED 100,000 - 105,000", price: 100000 },
        { trim: "2.5L I4 LX FWD", display: "AED 115,000 - 120,000", price: 115000 },
        { trim: "2.5L I4 PE FWD", display: "AED 149,100 - 150,000", price: 149100 },
      ],
    },
    "Picanto": {
      year: 2026,
      trims: [{ trim: "1.2L I4 EX FWD", display: "AED 62,895 - 63,895", price: 62895 }],
    },
    "Seltos": {
      year: 2026,
      trims: [{ trim: "1.4TC I4 SX FWD", display: "AED 98,750 - 99,000", price: 98750 }],
    },
    "Sorento": {
      year: 2026,
      trims: [
        { trim: "3.5 V6 LX 4WD", display: "AED 136,500 - 146,500", price: 136500 },
        { trim: "3.5 V6 EX 4WD", display: "AED 184,000 - 194,000", price: 184000 },
      ],
    },
    "Sportage": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 LX 4WD", display: "AED 113,400 - 114,000", price: 113400 },
        { trim: "1.5TC I4 EX FWD", display: "AED 117,600 - 118,000", price: 117600 },
        { trim: "2.0TC I4 EX 4WD", display: "AED 128,100 - 129,000", price: 128100 },
        { trim: "1.5TC I4 SX FWD", display: "AED 138,495 - 139,000", price: 138495 },
        { trim: "2.0TC I4 SX 4WD", display: "AED 149,100 - 150,000", price: 149100 },
      ],
    },
  },
  Lamborghini: {
    "Urus": {
      year: 2025,
      trims: [{ trim: "4.0TC V8 Performante 4WD", display: "AED 1,500,000 - 1,600,000", price: 1500000 }],
    },
  },
  // Note: stored as "LandRover" (no space) to match source data key
  LandRover: {
    "Range Rover": {
      year: 2026,
      trims: [
        { trim: "SE P400", display: "AED 599,900 - 604,900", price: 599900 },
        { trim: "HSE P360", display: "AED 626,400 - 643,800", price: 626400 },
        { trim: "Autobiography P530", display: "AED 821,900 - 830,000", price: 821900 },
        { trim: "SV P615", display: "AED 1,058,700 - 1,065,900", price: 1058700 },
      ],
    },
    "Range Rover Evoque": {
      year: 2026,
      trims: [
        { trim: "R-Dynamic", display: "AED 213,900 - 226,000", price: 213900 },
        { trim: "Autobiography", display: "AED 299,000 - 300,000", price: 299000 },
      ],
    },
    "Range Rover Sport": {
      year: 2026,
      trims: [
        { trim: "Dynamic SE P360", display: "AED 479,600 - 485,000", price: 479600 },
        { trim: "SV Edition Two P635", display: "AED 930,900 - 1,000,000", price: 930900 },
      ],
    },
    "Range Rover Velar": {
      year: 2026,
      trims: [
        { trim: "Dynamic SE P250", display: "AED 303,700 - 310,800", price: 303700 },
        { trim: "Autobiography P400", display: "AED 430,700 - 460,000", price: 430700 },
      ],
    },
  },
  Lexus: {
    "ES": {
      year: 2026,
      trims: [
        { trim: "3.5 V6 ES 350 Prestige FWD", display: "AED 240,000 - 242,000", price: 240000 },
        { trim: "3.5 V6 ES 350 F-Sport FWD", display: "AED 255,000 - 256,000", price: 255000 },
        { trim: "3.5 V6 ES 350 Platinum FWD", display: "AED 265,000 - 266,000", price: 265000 },
      ],
    },
    "LC": {
      year: 2025,
      trims: [
        { trim: "5.0 V8 Platinum RWD", display: "AED 455,000 - 440,000", price: 455000 },
        { trim: "5.0 V8 Carbon RWD", display: "AED 485,000 - 490,000", price: 485000 },
      ],
    },
    "LX": {
      year: 2026,
      trims: [
        { trim: "3.5TC V6 LX600 Overtrail 4WD", display: "AED 525,000 - 530,000", price: 525000 },
        { trim: "3.5TC V6 LX600 VIP 4WD", display: "AED 650,000 - 660,000", price: 650000 },
      ],
    },
    "RX": {
      year: 2026,
      trims: [{ trim: "2.4TC I4 F-Sport 4WD", display: "AED 325,000 - 326,000", price: 325000 }],
    },
  },
  Lincoln: {
    "Aviator": {
      year: 2026,
      trims: [{ trim: "3.0TC V6 Presidential 4WD", display: "AED 325,395 - 326,000", price: 325395 }],
    },
    "Nautilus": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 Reserve 2 4WD", display: "AED 257,145 - 258,000", price: 257145 },
        { trim: "2.0TC+E I4 Presidential 4WD", display: "AED 314,895 - 316,000", price: 314895 },
      ],
    },
    "Navigator": {
      year: 2026,
      trims: [
        { trim: "Reserve", display: "AED 411,495 - 412,000", price: 411495 },
        { trim: "Presidential", display: "AED 447,195 - 448,000", price: 447195 },
      ],
    },
  },
  Lotus: {
    "Emira": {
      year: 2025,
      trims: [{ trim: "3.5SC Launch Edition", display: "AED 395,000 - 400,000", price: 395000 }],
    },
  },
  MG: {
    "Cyberster": {
      year: 2026,
      trims: [{ trim: "Dual motor AWD", display: "AED 280,000 - 290,000", price: 280000 }],
    },
    "HS": {
      year: 2025,
      trims: [{ trim: "2.0T I4 Luxury FWD", display: "AED 107,000 - 110,000", price: 107000 }],
    },
    "ZS": {
      year: 2026,
      trims: [
        { trim: "1.5 I4 Luxury FWD", display: "AED 71,104 - 72,104", price: 71104 },
        { trim: "1.3TC I4 Luxury FWD", display: "AED 78,174 - 79,174", price: 78174 },
      ],
    },
  },
  Maserati: {
    "Levante": {
      year: 2025,
      trims: [
        { trim: "3.0TC V6 Modena 4WD", display: "AED 429,000 - 430,000", price: 429000 },
        { trim: "3.8TC V8 Trofeo 4WD", display: "AED 689,000 - 690,000", price: 689000 },
      ],
    },
    "MC20": {
      year: 2025,
      trims: [{ trim: "3.0TC V6 Cielo RWD", display: "AED 1,149,000 - 1,500,000", price: 1149000 }],
    },
  },
  Mazda: {
    "3": {
      year: 2025,
      trims: [{ trim: "2.0 l4 Intense FWD", display: "AED 109,000 - 110,000", price: 109000 }],
    },
    "6": {
      year: 2025,
      trims: [
        { trim: "2.5L I4 Core FWD", display: "AED 96,000 - 97,000", price: 96000 },
        { trim: "2.5L Luxe FWD", display: "AED 105,000 - 106,000", price: 105000 },
      ],
    },
    "CX-30": {
      year: 2026,
      trims: [{ trim: "2.0 Trend AWD", display: "AED 99,900 - 105,000", price: 99900 }],
    },
    "CX-5": {
      year: 2026,
      trims: [
        { trim: "GT AWD", display: "AED 110,000 - 115,000", price: 110000 },
        { trim: "Signature AWD", display: "AED 125,000 - 130,000", price: 125000 },
      ],
    },
    "CX-60": {
      year: 2026,
      trims: [{ trim: "3.3H I6 full options 4WD", display: "AED 204,000 - 205,000", price: 204000 }],
    },
  },
  Mini: {
    "Cooper": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 Cooper S Luxury FWD", display: "AED 180,000 - 190,000", price: 180000 }],
    },
    "Countryman": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 Cooper S Luxury 4WD", display: "AED 220,000 - 230,000", price: 220000 },
        { trim: "2.0TC I4 John Cooper Works 4WD", display: "AED 250,950 - 260,950", price: 250950 },
      ],
    },
  },
  Mitsubishi: {
    "ASX": {
      year: 2026,
      trims: [{ trim: "2.0 I4 GLX 4WD", display: "AED 84,000 - 89,000", price: 84000 }],
    },
    "Eclipse Cross": {
      year: 2026,
      trims: [
        { trim: "1.5TC I4 GLS Medium FWD", display: "AED 105,000 - 107,000", price: 105000 },
        { trim: "1.5TC I4 GLS High FWD", display: "AED 118,000 - 119,000", price: 118000 },
      ],
    },
    "Outlander": {
      year: 2026,
      trims: [
        { trim: "2.5 I4 HL 4WD", display: "AED 120,000 - 130,000", price: 120000 },
        { trim: "2.5 I4 Premium 4WD", display: "AED 142,000 - 145,000", price: 142000 },
      ],
    },
    "Xpander": {
      year: 2026,
      trims: [{ trim: "1.5 I4 Full Line FWD", display: "AED 90,000 - 91,000", price: 90000 }],
    },
  },
  Nio: {
    "ET5": {
      year: 2026,
      trims: [{ trim: "100 kWh long range 4WD", display: "AED 230,000 - 256,600", price: 230000 }],
    },
  },
  Nissan: {
    "Altima": {
      year: 2026,
      trims: [
        { trim: "2.5L I4 Sport FWD", display: "AED 119,500 - 120,000", price: 119500 },
        { trim: "2.5L I4 SV FWD", display: "AED 120,500 - 129,500", price: 120500 },
        { trim: "2.5L I4 SL FWD", display: "AED 136,000 - 137,000", price: 136000 },
        { trim: "2.0TC I4 SL FWD", display: "AED 146,500 - 147,000", price: 146500 },
      ],
    },
    "Pathfinder": {
      year: 2026,
      trims: [
        { trim: "3.5L V6 S 4WD", display: "AED 170,500 - 171,000", price: 170500 },
        { trim: "3.5L V6 SL 4WD", display: "AED 213,000 - 214,000", price: 213000 },
      ],
    },
    "Patrol": {
      year: 2026,
      trims: [
        { trim: "3.8 V6 SE T2 4WD", display: "AED 258,900 - 260,000", price: 258900 },
        { trim: "3.5TC V6 LE Platinum City 4WD", display: "AED 388,900 - 390,000", price: 388900 },
      ],
    },
    "Sunny": {
      year: 2025,
      trims: [
        { trim: "1.6L SV FWD", display: "AED 66,500 - 67,000", price: 66500 },
        { trim: "1.6L SL FWD", display: "AED 76,500 - 77,000", price: 76500 },
        { trim: "1.6 SL Plus FWD", display: "AED 81,500 - 82,000", price: 81500 },
      ],
    },
    "X-Trail": {
      year: 2026,
      trims: [
        { trim: "SV 4WD", display: "AED 126,000 - 127,000", price: 126000 },
        { trim: "SL 4WD", display: "AED 153,000 - 154,000", price: 153000 },
      ],
    },
  },
  Opel: {
    "Corsa": {
      year: 2025,
      trims: [{ trim: "1.2TC I3 Elegance Plus FWD", display: "AED 94,000 - 95,000", price: 94000 }],
    },
    "Grandland": {
      year: 2026,
      trims: [{ trim: "1.6TC I4 Business Elegance FWD", display: "AED 110,000 - 112,000", price: 110000 }],
    },
    "Mokka": {
      year: 2026,
      trims: [{ trim: "1.2TC I4 Ultimate FWD", display: "AED 116,000 - 118,000", price: 116000 }],
    },
  },
  Peugeot: {
    "2008": {
      year: 2026,
      trims: [
        { trim: "1.2TC I3 Allure Turbo", display: "AED 101,900 - 102,000", price: 101900 },
        { trim: "1.2TC I3 GT", display: "AED 111,900 - 112,000", price: 111900 },
      ],
    },
    "208": {
      year: 2025,
      trims: [{ trim: "1.2TC I3 GT FWD", display: "AED 86,900 - 87,000", price: 86900 }],
    },
    "3008": {
      year: 2026,
      trims: [{ trim: "1.6TC I4 GT FWD", display: "AED 129,900 - 130,000", price: 129900 }],
    },
    "408": {
      year: 2026,
      trims: [{ trim: "1.6TC I4 GT FWD", display: "AED 139,900 - 140,000", price: 139900 }],
    },
    "5008": {
      year: 2025,
      trims: [{ trim: "1.6TC I4 GT Line FWD", display: "AED 149,900 - 150,000", price: 149900 }],
    },
  },
  Polestar: {
    "2": {
      year: 2025,
      trims: [
        { trim: "82 kWh long range FWD", display: "AED 214,900 - 215,000", price: 214900 },
        { trim: "82 kWh dual motor Pilot Pack", display: "AED 273,900 - 274,000", price: 273900 },
      ],
    },
    "3": {
      year: 2025,
      trims: [
        { trim: "111 kWh Dual motor 4WD", display: "AED 274,900 - 280,000", price: 274900 },
        { trim: "111 kWh Dual motor PRFM 4WD", display: "AED 289,900 - 290,000", price: 289900 },
      ],
    },
    "4": {
      year: 2026,
      trims: [{ trim: "Long Range Dual Motor", display: "AED 237,900 - 249,000", price: 237900 }],
    },
  },
  Porsche: {
    "911": {
      year: 2026,
      trims: [
        { trim: "3.0TC F6 911 Carrera S RWD", display: "AED 604,400 - 620,000", price: 604400 },
        { trim: "3.0TC F6 911 Carrera 4 GTS AWD", display: "AED 695,800 - 720,000", price: 695800 },
      ],
    },
    "911 Turbo": {
      year: 2026,
      trims: [{ trim: "3.8TC F6 Turbo S 4WD", display: "AED 889,900 - 899,000", price: 889900 }],
    },
    "Cayenne": {
      year: 2026,
      trims: [
        { trim: "4.0TC V8 S 4WD", display: "AED 440,600 - 442,000", price: 440600 },
        { trim: "4.0TC+E V8 Turbo E-Hybrid 4WD", display: "AED 663,400 - 665,000", price: 663400 },
      ],
    },
    "Cayenne Coupe": {
      year: 2025,
      trims: [
        { trim: "Cayenne E-Hybrid", display: "AED 394,000 - 430,000", price: 394000 },
        { trim: "Cayenne Turbo S E-Hybrid Coupe", display: "AED 700,000 - 720,000", price: 700000 },
      ],
    },
    "Macan": {
      year: 2026,
      trims: [
        { trim: "2.0TC I4 Macan T 4WD", display: "AED 286,400 - 310,000", price: 286400 },
        { trim: "3.0TC Macan GTS 4WD", display: "AED 366,900 - 380,000", price: 366900 },
      ],
    },
    "Panamera": {
      year: 2026,
      trims: [
        { trim: "2.9TC+E V6 Panamera 4 4WD", display: "AED 425,100 - 430,000", price: 425100 },
        { trim: "4.0H V8 Panamera Turbo E-Hybrid", display: "AED 750,600 - 751,000", price: 750600 },
      ],
    },
    "Taycan": {
      year: 2026,
      trims: [
        { trim: "89 kWh 4 4WD", display: "AED 444,700 - 480,000", price: 444700 },
        { trim: "105 kWh GTS 4WD", display: "AED 594,700 - 610,000", price: 594700 },
      ],
    },
  },
  RAM: {
    "1500": {
      year: 2026,
      trims: [
        { trim: "Standard Output Rebel", display: "AED 274,900 - 275,000", price: 274900 },
        { trim: "High Output RHO", display: "AED 399,900 - 400,000", price: 399900 },
      ],
    },
  },
  Renault: {
    "Duster": {
      year: 2025,
      trims: [
        { trim: "1.6L I4 SE FWD", display: "AED 72,000 - 73,000", price: 72000 },
        { trim: "1.6L I4 LE FWD", display: "AED 75,500 - 76,000", price: 75500 },
      ],
    },
    "Koleos": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 Iconic 4WD", display: "AED 137,000 - 138,000", price: 137000 }],
    },
    "Megane": {
      year: 2025,
      trims: [{ trim: "1.6L Techno FWD", display: "AED 88,500 - 89,000", price: 88500 }],
    },
  },
  Skoda: {
    "Kamiq": {
      year: 2025,
      trims: [{ trim: "1.6L I4 Style FWD", display: "AED 93,000 - 94,000", price: 93000 }],
    },
    "Karoq": {
      year: 2025,
      trims: [
        { trim: "1.4TC I4 Style FWD", display: "AED 169,000 - 170,000", price: 169000 },
        { trim: "2.0TC I4 Sportline 4WD", display: "AED 185,000 - 186,000", price: 185000 },
      ],
    },
    "Kodiaq": {
      year: 2026,
      trims: [
        { trim: "1.4TC I4 Selection Plus FWD", display: "AED 166,000 - 167,000", price: 166000 },
        { trim: "1.4TC I4 Sportline 4WD", display: "AED 172,000 - 173,000", price: 172000 },
      ],
    },
    "Octavia": {
      year: 2026,
      trims: [
        { trim: "1.4TC I4 Style FWD", display: "AED 123,000 - 125,000", price: 123000 },
        { trim: "2.0TC I4 RS FWD", display: "AED 145,000 - 146,000", price: 145000 },
      ],
    },
    "Superb": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 L&K FWD", display: "AED 162,000 - 163,000", price: 162000 }],
    },
  },
  Subaru: {
    "BRZ": {
      year: 2025,
      trims: [
        { trim: "2.4 I4 Premium Eyesight Brembo M/T RWD", display: "AED 128,000 - 129,000", price: 128000 },
        { trim: "2.4 I4 Premium Eyesight Brembo A/T RWD", display: "AED 138,000 - 139,000", price: 138000 },
      ],
    },
    "Crosstrek": {
      year: 2025,
      trims: [
        { trim: "2.0TC F4 S-Eyesight 4WD", display: "AED 115,000 - 116,000", price: 115000 },
        { trim: "2.0TC F4 L-Eyesight 4WD", display: "AED 125,000 - 126,000", price: 125000 },
      ],
    },
    "Forester": {
      year: 2026,
      trims: [
        { trim: "Sport", display: "AED 135,000 - 136,000", price: 135000 },
        { trim: "Premium", display: "AED 140,000 - 141,000", price: 140000 },
      ],
    },
  },
  Suzuki: {
    "Baleno": {
      year: 2026,
      trims: [{ trim: "1.5L I4 GLX FWD", display: "AED 59,900 - 60,000", price: 59900 }],
    },
    "Jimny": {
      year: 2026,
      trims: [
        { trim: "1.5 I4 GLX A/T 4WD", display: "AED 91,900 - 92,900", price: 91900 },
        { trim: "1.5 I4 ART Edition A/T 4WD", display: "AED 98,900 - 113,000", price: 98900 },
      ],
    },
    "Swift": {
      year: 2026,
      trims: [
        { trim: "1.2L I4 GL Plus FWD", display: "AED 54,900 - 56,900", price: 54900 },
        { trim: "1.2 I4 GLX FWD", display: "AED 59,900 - 61,900", price: 59900 },
      ],
    },
  },
  Tesla: {
    "Cybertruck": {
      year: 2026,
      trims: [{ trim: "123 kWh Cyberbeast 4WD", display: "AED 455,000 - 475,000", price: 455000 }],
    },
    "Model 3": {
      year: 2025,
      trims: [
        { trim: "60 kWh Long Range RWD", display: "AED 164,990 - 168,000", price: 164990 },
        { trim: "82 kWh Long Range 4WD", display: "AED 184,990 - 186,990", price: 184990 },
      ],
    },
    "Model S": {
      year: 2026,
      trims: [
        { trim: "100D", display: "AED 367,000 - 441,000", price: 367000 },
        { trim: "P100D", display: "AED 533,000 - 580,000", price: 533000 },
      ],
    },
    "Model X": {
      year: 2026,
      trims: [{ trim: "Plaid Tri motor AWD", display: "AED 477,900 - 485,000", price: 477900 }],
    },
    "Model Y": {
      year: 2025,
      trims: [
        { trim: "78 kWh Long Range RWD", display: "AED 184,990 - 190,000", price: 184990 },
        { trim: "78 kWh Long Range AWD", display: "AED 204,990 - 210,000", price: 204990 },
      ],
    },
  },
  Toyota: {
    "Camry": {
      year: 2026,
      trims: [
        { trim: "XLE Hybrid", display: "AED 125,900 - 127,000", price: 125900 },
        { trim: "GLE", display: "AED 139,900 - 140,000", price: 139900 },
        { trim: "Sport", display: "AED 141,900 - 142,000", price: 141900 },
        { trim: "Limited Hybrid", display: "AED 151,900 - 152,000", price: 151900 },
      ],
    },
    "Corolla": {
      year: 2026,
      trims: [
        { trim: "1.6 I4 GLi FWD", display: "AED 82,900 - 83,000", price: 82900 },
        { trim: "2.0 I4 XLi FWD", display: "AED 83,900 - 84,000", price: 83900 },
        { trim: "1.8H I4 Hybrid FWD", display: "AED 87,900 - 88,000", price: 87900 },
      ],
    },
    "Fortuner": {
      year: 2026,
      trims: [
        { trim: "4.0L GXR 4WD", display: "AED 154,900 - 155,000", price: 154900 },
        { trim: "4.0L VXR 4WD", display: "AED 173,900 - 174,000", price: 173900 },
      ],
    },
    "Highlander": {
      year: 2025,
      trims: [{ trim: "2.5H I4 VXR 4WD", display: "AED 199,900 - 200,000", price: 199900 }],
    },
    "Hilux": {
      year: 2026,
      trims: [
        { trim: "2.7 Double Cab 4x2", display: "AED 89,900 - 90,000", price: 89900 },
        { trim: "4.0 V6 Hilux GR Sport", display: "AED 147,900 - 148,000", price: 147900 },
      ],
    },
    "Land Cruiser": {
      year: 2026,
      trims: [
        { trim: "4.0 V6 GXR 4WD", display: "AED 274,900 - 275,000", price: 274900 },
        { trim: "3.5TC V6 GR-S Hybrid 4WD", display: "AED 409,900 - 410,000", price: 409900 },
      ],
    },
    "Land Cruiser Prado": {
      year: 2025,
      trims: [
        { trim: "2.4TC I4 GXR 4WD", display: "AED 219,900 - 220,000", price: 219900 },
        { trim: "2.4 TC I4 VXR 4WD", display: "AED 264,900 - 265,000", price: 264900 },
      ],
    },
    "RAV4": {
      year: 2026,
      trims: [
        { trim: "2.0 EXR FWD", display: "AED 113,900 - 114,000", price: 113900 },
        { trim: "2.5H Adventure AWD", display: "AED 142,900 - 143,000", price: 142900 },
      ],
    },
    "Raize": {
      year: 2026,
      trims: [{ trim: "1.0TC I3 G 2WD", display: "AED 66,900 - 67,000", price: 66900 }],
    },
  },
  Volkswagen: {
    "Tiguan": {
      year: 2025,
      trims: [{ trim: "1.4TC I4 R-Line FWD", display: "AED 152,040 - 155,000", price: 152040 }],
    },
    "Touareg": {
      year: 2025,
      trims: [
        { trim: "3.0TC V6 Trend 4WD", display: "AED 220,000 - 230,000", price: 220000 },
        { trim: "3.0TC V6 R-Line 4WD", display: "AED 260,000 - 265,000", price: 260000 },
      ],
    },
  },
  Volvo: {
    "XC40": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 B5 MHEV Ultimate FWD", display: "AED 195,000 - 200,000", price: 195000 }],
    },
    "XC60": {
      year: 2026,
      trims: [{ trim: "2.0TC I4 B5 Ultra Bright AWD", display: "AED 309,900 - 310,900", price: 309900 }],
    },
    "XC90": {
      year: 2025,
      trims: [
        { trim: "2.0H I4 B6 Ultra Bright 4WD", display: "AED 329,900 - 339,900", price: 329900 },
        { trim: "2.0H I4 T8 Ultra Dark PHEV 4WD", display: "AED 424,875 - 434,875", price: 424875 },
      ],
    },
  },
  XPeng: {
    "G9": {
      year: 2026,
      trims: [
        { trim: "93.1 kWh long range RWD", display: "AED 231,900 - 232,000", price: 231900 },
        { trim: "93.1 kWh performance RWD", display: "AED 252,900 - 253,000", price: 252900 },
      ],
    },
  },
  "Mercedes-Benz": {
    "A-Class": {
      year: 2025,
      trims: [
        { trim: "A 200", display: "AED 139,000 - 155,000", price: 139000 },
        { trim: "A 250", display: "AED 165,000 - 175,000", price: 165000 },
      ],
    },
    "C-Class": {
      year: 2025,
      trims: [
        { trim: "C 200", display: "AED 195,000 - 215,000", price: 195000 },
        { trim: "C 300", display: "AED 230,000 - 250,000", price: 230000 },
        { trim: "C 43 AMG", display: "AED 310,000 - 330,000", price: 310000 },
        { trim: "C 63 AMG", display: "AED 420,000 - 450,000", price: 420000 },
      ],
    },
    "E-Class": {
      year: 2025,
      trims: [
        { trim: "E 200", display: "AED 245,000 - 265,000", price: 245000 },
        { trim: "E 300", display: "AED 285,000 - 310,000", price: 285000 },
        { trim: "E 450", display: "AED 345,000 - 370,000", price: 345000 },
        { trim: "E 53 AMG", display: "AED 430,000 - 460,000", price: 430000 },
        { trim: "E 63 AMG", display: "AED 590,000 - 620,000", price: 590000 },
      ],
    },
    "S-Class": {
      year: 2025,
      trims: [
        { trim: "S 450", display: "AED 560,000 - 600,000", price: 560000 },
        { trim: "S 500", display: "AED 640,000 - 680,000", price: 640000 },
        { trim: "S 580", display: "AED 750,000 - 800,000", price: 750000 },
        { trim: "S 63 AMG", display: "AED 950,000 - 1,050,000", price: 950000 },
      ],
    },
    "GLA": {
      year: 2025,
      trims: [
        { trim: "GLA 200", display: "AED 155,000 - 170,000", price: 155000 },
        { trim: "GLA 250", display: "AED 185,000 - 200,000", price: 185000 },
        { trim: "GLA 35 AMG", display: "AED 250,000 - 265,000", price: 250000 },
      ],
    },
    "GLC": {
      year: 2025,
      trims: [
        { trim: "GLC 200", display: "AED 225,000 - 245,000", price: 225000 },
        { trim: "GLC 300", display: "AED 265,000 - 285,000", price: 265000 },
        { trim: "GLC 43 AMG", display: "AED 360,000 - 385,000", price: 360000 },
        { trim: "GLC 63 AMG", display: "AED 490,000 - 520,000", price: 490000 },
      ],
    },
    "GLE": {
      year: 2025,
      trims: [
        { trim: "GLE 300d", display: "AED 320,000 - 345,000", price: 320000 },
        { trim: "GLE 450", display: "AED 380,000 - 410,000", price: 380000 },
        { trim: "GLE 53 AMG", display: "AED 500,000 - 530,000", price: 500000 },
        { trim: "GLE 63 AMG", display: "AED 650,000 - 700,000", price: 650000 },
      ],
    },
    "GLS": {
      year: 2025,
      trims: [
        { trim: "GLS 450", display: "AED 460,000 - 490,000", price: 460000 },
        { trim: "GLS 580", display: "AED 590,000 - 630,000", price: 590000 },
        { trim: "GLS 63 AMG", display: "AED 780,000 - 830,000", price: 780000 },
      ],
    },
    "CLA": {
      year: 2025,
      trims: [
        { trim: "CLA 200", display: "AED 165,000 - 180,000", price: 165000 },
        { trim: "CLA 250", display: "AED 195,000 - 210,000", price: 195000 },
        { trim: "CLA 35 AMG", display: "AED 265,000 - 280,000", price: 265000 },
        { trim: "CLA 45 AMG", display: "AED 330,000 - 355,000", price: 330000 },
      ],
    },
    "CLS": {
      year: 2025,
      trims: [
        { trim: "CLS 350", display: "AED 340,000 - 365,000", price: 340000 },
        { trim: "CLS 450", display: "AED 395,000 - 420,000", price: 395000 },
        { trim: "CLS 53 AMG", display: "AED 510,000 - 545,000", price: 510000 },
      ],
    },
    "G-Class": {
      year: 2025,
      trims: [
        { trim: "G 500", display: "AED 620,000 - 660,000", price: 620000 },
        { trim: "G 63 AMG", display: "AED 850,000 - 920,000", price: 850000 },
      ],
    },
    "GLB": {
      year: 2025,
      trims: [
        { trim: "GLB 200", display: "AED 175,000 - 190,000", price: 175000 },
        { trim: "GLB 250", display: "AED 205,000 - 220,000", price: 205000 },
        { trim: "GLB 35 AMG", display: "AED 270,000 - 285,000", price: 270000 },
      ],
    },
    "SL": {
      year: 2025,
      trims: [
        { trim: "SL 43 AMG", display: "AED 450,000 - 480,000", price: 450000 },
        { trim: "SL 55 AMG", display: "AED 590,000 - 630,000", price: 590000 },
        { trim: "SL 63 AMG", display: "AED 720,000 - 770,000", price: 720000 },
      ],
    },
    "EQS": {
      year: 2025,
      trims: [
        { trim: "EQS 450+", display: "AED 420,000 - 450,000", price: 420000 },
        { trim: "EQS 580", display: "AED 520,000 - 560,000", price: 520000 },
      ],
    },
  },
};

export default carPrices;
