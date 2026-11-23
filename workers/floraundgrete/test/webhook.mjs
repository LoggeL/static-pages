// Webhook-Test gegen `wrangler dev` (lokal). Aufruf: node test/webhook.mjs whsec_…
import { signForTest } from "../src/stripe.js";
const secret = process.argv[2];
const url = "http://127.0.0.1:8787/api/stripe/webhook";
const ev = (id, type, object) => JSON.stringify({ id, type, data: { object } });
const send = async (body, header) => { const r = await fetch(url, { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body }); return `${r.status} ${await r.text()}`; };
const session = { id: "cs_test_900", object: "checkout.session", metadata: { order_id: "900" }, client_reference_id: "900", payment_status: "paid", amount_total: 3190, payment_intent: "pi_test_900",
  customer_details: { name: "Testkundin", email: "kundin@example.de", phone: "+49 170 1" }, collected_information: { shipping_details: { name: "Test Kundin", address: { line1: "Hauptstr. 1", postal_code: "67305", city: "Ramsen", country: "DE" } } } };
const paid = ev("evt_paid_1", "checkout.session.completed", session);
console.log("gefälscht:   ", await send(paid, "t=1,v1=deadbeef"));
console.log("zu alt:      ", await send(paid, await signForTest(paid, secret, Math.floor(Date.now() / 1000) - 3600)));
console.log("falsches Secret:", await send(paid, await signForTest(paid, "whsec_falsch")));
console.log("echt:        ", await send(paid, await signForTest(paid, secret)));
console.log("doppelt:     ", await send(paid, await signForTest(paid, secret)));
const other = ev("evt_paid_2", "checkout.session.completed", { ...session, id: "cs_fremd" });
console.log("fremde Session:", await send(other, await signForTest(other, secret)));
const dispute = ev("evt_dp_1", "charge.dispute.created", { object: "dispute", payment_intent: "pi_test_900", status: "needs_response", reason: "product_not_received", amount: 3190, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 } });
console.log("Rückbuchung: ", await send(dispute, await signForTest(dispute, secret)));
