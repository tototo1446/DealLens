const url = process.env.GAS_WEB_APP_URL;
const secret = process.env.GAS_SHARED_SECRET;

if (!url || !secret) {
  console.error("env missing");
  process.exit(1);
}

console.log("URL:", url);
console.log("SECRET prefix:", secret.slice(0, 10) + "...");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "ping", secret }),
  redirect: "follow",
});

console.log("status:", res.status);
console.log("content-type:", res.headers.get("content-type"));
const text = await res.text();
console.log("body (first 500):", text.slice(0, 500));
