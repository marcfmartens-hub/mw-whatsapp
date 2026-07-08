import type { Conversation } from "./lib/supabase";
import { createBiginContact } from "./lib/bigin";

const testConv: Conversation = {
  phone: "971585566369",
  step: 9,
  name: "Marc Martens",
  phone_number: "971585566369",
  car: "BMW X6 2023",
  make: "BMW",
  model: "X6",
  year: "2023",
  mileage: "12000",
  specs: "GCC",
  loan: "Yes",
  mortgage_amount: "340000",
  sell_timeline: "as soon as possible",
  appointment: "Wednesday 8th July at 10am",
  appointment_date: "Wednesday 8th July",
  appointment_time: "10am",
  last_msg_id: null,
  nudged_at: null,
  source_url: "WhatsApp Bot",
  last_message_at: null,
  bigin_pushed_at: null,
};

console.log("Pushing full test contact to Bigin...\n");
createBiginContact(testConv)
  .then(() => console.log("\nDone."))
  .catch((e) => console.error("Failed:", e));
