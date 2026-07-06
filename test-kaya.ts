import { getKayaReply, extractVehicleInfo, KnownFields } from "./lib/claude";

// Simulate a full conversation, printing each exchange
async function simulate(label: string, turns: { msg: string }[]) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log("=".repeat(60));

  const known: KnownFields = {};
  let step = 1; // step 1 = after greeting was sent

  for (const turn of turns) {
    console.log(`\n[Customer @ step ${step}]: ${turn.msg}`);

    // Extract vehicle fields
    const vehicleFields = await extractVehicleInfo(turn.msg, {
      make: known.make as string | undefined,
      model: known.model as string | undefined,
      year: known.year as string | undefined,
      mileage: known.mileage as string | undefined,
      specs: known.specs as string | undefined,
    });

    // Merge into known
    Object.assign(known, vehicleFields);

    const reply = await getKayaReply(step, [], turn.msg, known);
    console.log(`[Kaya]:     ${reply}`);
    console.log(`[Known]:    ${JSON.stringify(known)}`);

    step++;
  }
}

async function main() {
  // Test 1: All info in one message
  await simulate("All car info in one message", [
    { msg: "Marc" },
    { msg: "I want to sell my BMW 520 2019, 125k km, GCC" },
    { msg: "No loan" },
    { msg: "Tomorrow at 3pm" },
    { msg: "0585566369" },
  ]);

  // Test 2: Info spread across multiple messages
  await simulate("Info spread across messages", [
    { msg: "Sarah" },
    { msg: "I want to sell my car" },
    { msg: "Toyota Camry" },
    { msg: "2021" },
    { msg: "80k and its GCC" },
    { msg: "No outstanding loan" },
    { msg: "Wednesday 11am" },
    { msg: "055 123 4567" },
  ]);

  // Test 3: Year given in a different step
  await simulate("Year given late", [
    { msg: "Ahmed" },
    { msg: "BMW X5, non gcc, 60000 km" },
    { msg: "The year is 2022" },
    { msg: "Yes there is a loan" },
    { msg: "Sunday 2pm" },
    { msg: "050 999 8877" },
  ]);

  // Test 4: Customer only gives make/model, year comes later
  await simulate("Partial info then specs", [
    { msg: "Ali" },
    { msg: "I have a Nissan Patrol" },
    { msg: "2020, about 95,000 km" },
    { msg: "local specs" },
    { msg: "No loan" },
    { msg: "Friday morning" },
    { msg: "056 000 1111" },
  ]);
}

main().catch(console.error);
