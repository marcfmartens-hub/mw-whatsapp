// Canonical car makes with display names and their valid models.
// Used in extractVehicleInfo to validate and normalise customer input.

export const CAR_MAKES: Record<string, string> = {
  Acura: "Acura", AlfaRomeo: "Alfa Romeo", Alpina: "Alpina",
  AstonMartin: "Aston Martin", Audi: "Audi", Abarth: "Abarth",
  Bentley: "Bentley", BMW: "BMW", Baojun: "Baojun", Bugatti: "Bugatti",
  BYD: "BYD", Brilliance: "Brilliance", Buick: "Buick",
  Cadillac: "Cadillac", Changan: "Changan", Chevrolet: "Chevrolet",
  Chrysler: "Chrysler", Citroën: "Citroën", Cupra: "Cupra",
  Dacia: "Dacia", Daewoo: "Daewoo", Daihatsu: "Daihatsu",
  Dodge: "Dodge", Dongfeng: "Dongfeng", Exeed: "Exeed",
  Ferrari: "Ferrari", Fiat: "Fiat", Fisker: "Fisker", Ford: "Ford",
  Geely: "Geely", Genesis: "Genesis", GMC: "GMC", GreatWall: "Great Wall",
  GAC: "GAC", Haval: "Haval", Honda: "Honda", Hummer: "Hummer",
  Hyundai: "Hyundai", Infiniti: "Infiniti", Isuzu: "Isuzu",
  Jaguar: "Jaguar", Jeep: "Jeep", Jetour: "Jetour", JAC: "JAC",
  Kia: "Kia", Koenigsegg: "Koenigsegg", Lamborghini: "Lamborghini",
  Lancia: "Lancia", LandRover: "Land Rover", Lexus: "Lexus",
  Lincoln: "Lincoln", Lotus: "Lotus", LucidMotors: "Lucid Motors",
  Maserati: "Maserati", Mazda: "Mazda", McLaren: "McLaren",
  Mercedes: "Mercedes-Benz", Mini: "Mini", Mitsubishi: "Mitsubishi",
  MG: "MG", Maybach: "Maybach", Nissan: "Nissan", Nio: "Nio",
  Opel: "Opel", Ora: "Ora", Pagani: "Pagani", Peugeot: "Peugeot",
  Polestar: "Polestar", Porsche: "Porsche", Proton: "Proton",
  RAM: "RAM", Renault: "Renault", Rimac: "Rimac", Rivian: "Rivian",
  RollsRoyce: "Rolls-Royce", Saab: "Saab", Seat: "SEAT", Skoda: "Škoda",
  Smart: "Smart", SsangYong: "SsangYong", Subaru: "Subaru",
  Suzuki: "Suzuki", Tesla: "Tesla", Toyota: "Toyota", TVR: "TVR",
  Volkswagen: "Volkswagen", Volvo: "Volvo", WMotors: "W Motors",
  XPeng: "XPeng", GMC2: "GMC",
};

export const CAR_MODELS: Record<string, string[]> = {
  "Alfa Romeo": ["Giulia","Stelvio","4C","Giulietta","MiTo","159","Brera","Spider","GTV"],
  Alpina: ["B3","B4","B5","B6","B7","D3","D4","XD3","XD4"],
  "Aston Martin": ["DB11","Vantage","DB9","Rapide","DBS","Vanquish","DB7","DB5","Lagonda","Valkyrie"],
  Audi: ["A1","A3","A4","A5","A6","A7","A8","Q2","Q3","Q5","Q7","Q8","TT","R8","e-tron","S3","S4","S5","S6","S7","S8","RS3","RS4","RS5","RS6","RS7","RS Q3","RS Q5","RS Q8"],
  Bentley: ["Continental GT","Flying Spur","Bentayga","Mulsanne","Arnage","Azure"],
  BMW: ["1 Series","2 Series","3 Series","4 Series","5 Series","6 Series","7 Series","8 Series","X1","X2","X3","X4","X5","X6","X7","Z4","M2","M3","M4","M5","M8","i3","i4","iX","i8","Z3","X5 M","X6 M","X3 M","X4 M"],
  BYD: ["Han","Tang","Song","Yuan","Qin","Atto 3","Seal","F3"],
  Cadillac: ["Escalade","CT4","CT5","CT6","XT4","XT5","XT6","ATS","CTS","SRX"],
  Chevrolet: ["Spark","Malibu","Cruze","Camaro","Corvette","Equinox","Traverse","Tahoe","Suburban","Blazer","Colorado","Silverado","Trailblazer","Bolt EV","Trax"],
  Dodge: ["Charger","Challenger","Durango","Journey","Viper","Ram 1500","Ram 2500","Ram 3500"],
  Ferrari: ["488 GTB","F8 Tributo","812 Superfast","SF90 Stradale","Portofino","Roma","LaFerrari","California","458 Italia","296 GTB"],
  Ford: ["F-150","Mustang","Explorer","Escape","Edge","Expedition","Ranger","Bronco","Maverick","Fusion","Taurus","Focus","Fiesta","EcoSport","GT","Transit"],
  Genesis: ["G70","G80","G90","GV60","GV70","GV80"],
  GMC: ["Sierra","Yukon","Canyon","Terrain","Acadia","Hummer EV"],
  Haval: ["H2","H6","H9","Jolion","F7","F7x","Dargo"],
  Honda: ["Civic","Accord","CR-V","HR-V","Pilot","Odyssey","Jazz","City","Fit","S2000","Ridgeline","BR-V"],
  Hummer: ["H1","H2","H3","EV Pickup","EV SUV"],
  Hyundai: ["Accent","Elantra","Sonata","Tucson","Santa Fe","Palisade","Creta","Kona","Venue","i10","i20","i30","Veloster","Staria"],
  Infiniti: ["Q30","Q50","Q60","Q70","QX30","QX50","QX55","QX56","QX60","QX70","QX80","G35","G37"],
  Isuzu: ["D-Max","MU-X","Trooper"],
  Jaguar: ["XE","XF","XJ","F-Pace","E-Pace","I-Pace","F-Type","XK","S-Type","X-Type"],
  Jeep: ["Wrangler","Wrangler Unlimited","Cherokee","Grand Cherokee","Grand Cherokee L","Compass","Renegade","Gladiator"],
  Jetour: ["T1","T2","X70","X70S","X90","X95"],
  Kia: ["Picanto","Rio","Cerato","Forte","K5","Cadenza","Stinger","Seltos","Sportage","Sorento","Telluride","Carnival","Soul","Niro","EV6","EV9","Mohave"],
  Lamborghini: ["Aventador","Huracan","Urus","Gallardo","Murcielago","Revuelto","Diablo","Countach"],
  "Land Rover": ["Defender","Discovery","Discovery Sport","Range Rover","Range Rover Sport","Range Rover Velar","Range Rover Evoque","Freelander","LR2","LR3","LR4"],
  Lexus: ["IS","ES","GS","LS","UX","NX","RX","GX","LX","RC","LC","CT","RC F","GS F","LX 600","NX 350","RX 500h"],
  Lincoln: ["Aviator","Corsair","Nautilus","Navigator","MKZ","MKX","Continental","Town Car"],
  Maserati: ["Ghibli","Quattroporte","Levante","GranTurismo","GranCabrio","MC20"],
  Mazda: ["2","3","6","CX-3","CX-30","CX-5","CX-50","CX-60","CX-7","CX-8","CX-9","MX-5","RX-7","RX-8"],
  McLaren: ["540C","570S","600LT","650S","720S","765LT","Artura","GT","P1","Senna"],
  "Mercedes-Benz": ["A-Class","B-Class","C-Class","CLA","CLE","CLS","E-Class","EQB","EQC","EQE","EQS","GLA","GLB","GLC","GLE","GLS","G-Class","S-Class","SL","AMG GT","V-Class","Maybach S-Class","Maybach GLS","Sprinter"],
  MG: ["MG3","MG5","MG6","ZS","HS","RX5","RX8","Marvel R","Cyberster"],
  Mini: ["Cooper","Cooper S","Clubman","Countryman","Convertible","John Cooper Works"],
  Mitsubishi: ["Lancer","Outlander","Pajero","ASX","Eclipse Cross","Mirage","Xpander","Triton","Attrage"],
  Nissan: ["Altima","Maxima","Sentra","Sunny","Micra","Tiida","Leaf","Juke","Qashqai","X-Trail","Murano","Pathfinder","Patrol","Navara","Armada","370Z","GT-R"],
  Porsche: ["911","911 Turbo","911 Carrera","911 GT3","718 Cayman","718 Boxster","Cayenne","Cayenne Coupe","Macan","Panamera","Taycan","Carrera GT"],
  RAM: ["1500","1500 TRX","2500","3500","ProMaster"],
  Renault: ["Clio","Captur","Megane","Koleos","Kadjar","Duster","Logan","Talisman","Symbol","ZOE","Arkana"],
  "Rolls-Royce": ["Phantom","Ghost","Wraith","Dawn","Cullinan","Spectre","Silver Shadow"],
  Subaru: ["Impreza","WRX","Legacy","Outback","Forester","Ascent","Crosstrek","BRZ"],
  Suzuki: ["Swift","Baleno","Ciaz","Ertiga","Vitara","Jimny","Alto","S-Cross"],
  Tesla: ["Model S","Model 3","Model X","Model Y","Cybertruck","Roadster"],
  Toyota: ["Corolla","Camry","Prius","Yaris","RAV4","Highlander","Land Cruiser","Land Cruiser Prado","Hilux","Fortuner","C-HR","Tacoma","Tundra","Supra","Sequoia","Avalon","Sienna","Venza","4Runner","FJ Cruiser","Avanza","Innova","Rush","Land Cruiser 70 Series"],
  Volkswagen: ["Golf","Polo","Passat","Tiguan","Touareg","Jetta","Arteon","Atlas","Beetle","ID.3","ID.4","ID. Buzz"],
  Volvo: ["S60","S90","V60","V90","XC40","XC60","XC90","C40"],
  "W Motors": ["Lykan Hypersport","Fenyr SuperSport"],
  Acura: ["ILX","TLX","RDX","MDX","NSX","Integra","ZDX"],
  GAC: ["GS3","GS4","GS5","GS7","GS8","GA4","GA6","GM8","EMKOO"],
  Geely: ["Coolray","Emgrand","Azkarra","Tugella"],
  Peugeot: ["208","308","408","508","2008","3008","5008","RCZ"],
  Skoda: ["Fabia","Rapid","Octavia","Superb","Scala","Karoq","Kodiaq","Kamiq","Enyaq"],
  SEAT: ["Ibiza","Leon","Arona","Ateca","Tarraco","Toledo"],
  Changan: ["CS35","CS55","CS75","CS85","CS95","UNI-K","UNI-T"],
};

// Compact string for injection into prompts
export const MAKES_LIST = Object.values(CAR_MAKES)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort()
  .join(", ");

// Returns "Make: model1, model2, ..." lines for top makes
export function getModelsReference(): string {
  return Object.entries(CAR_MODELS)
    .map(([make, models]) => `${make}: ${models.join(", ")}`)
    .join("\n");
}
