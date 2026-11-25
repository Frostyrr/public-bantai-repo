// Run against the local Vite dev server; all receipt inference is synthetic.
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
async function main() {
  const browser = await chromium.launch({channel:"msedge",headless:true});
  const output = mkdtempSync(path.join(tmpdir(),"bantai-receipt-ui-"));
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/*",route=>route.request().url().startsWith("http://127.0.0.1:5178/") || route.request().url().startsWith("data:") ? route.continue() : route.abort());
    const url="http://127.0.0.1:5178/tests/receiptAiHarness.html";
    await page.goto(url);await page.getByRole("button",{name:"Extract with AI"}).waitFor();
    assert.equal(await page.evaluate(()=>window.receiptTest.calls),0);
    await page.getByRole("button",{name:"Extract with AI"}).click();
    await page.getByRole("heading",{name:"Review suggestions"}).waitFor();
    const checked=await page.getByRole("checkbox").evaluateAll(elements=>elements.map(element=>element.checked));
    assert.deepEqual(checked,[false,true,false,false]);
    assert.equal(await page.evaluate(()=>window.receiptTest.applies),0);
    await page.getByRole("button",{name:"Apply selected fields"}).click();
    const values=JSON.parse(await page.getByLabel("Current expense values").textContent());
    assert.equal(values.title,"Manually entered title");assert.equal(values.amountCentavos,"99.00");assert.equal(values.vendorName,"BANTAI TEST STORE");
    await page.screenshot({path:path.join(output,"desktop-light.png"),fullPage:true});
    await page.setViewportSize({width:375,height:850});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:path.join(output,"mobile-light.png"),fullPage:true});
    await page.getByRole("button",{name:"Toggle theme"}).click();
    await page.screenshot({path:path.join(output,"mobile-dark.png"),fullPage:true});
    await page.goto(url);await page.getByRole("button",{name:"Extract with AI"}).click();
    await page.getByRole("heading",{name:"Review suggestions"}).waitFor();
    await page.getByRole("checkbox").nth(3).check();
    await page.getByRole("button",{name:"Edit current amount"}).click();
    await page.getByRole("button",{name:"Apply selected fields"}).click();
    await page.getByRole("alert").filter({hasText:"Some expense fields changed"}).waitFor();
    assert.equal(await page.evaluate(()=>window.receiptTest.applies),0);
    assert.equal(JSON.parse(await page.getByLabel("Current expense values").textContent()).amountCentavos,"77.00");
    await page.getByRole("checkbox").nth(3).check();
    await page.getByRole("button",{name:"Apply selected fields"}).click();
    assert.equal(JSON.parse(await page.getByLabel("Current expense values").textContent()).amountCentavos,"112.00");
    await page.goto(url);await page.getByRole("button",{name:"Extract with AI"}).click();
    await page.getByRole("button",{name:"Remove receipt"}).click();await page.waitForTimeout(350);
    assert.equal(await page.getByRole("heading",{name:"Review suggestions"}).count(),0);
    assert.equal(await page.evaluate(()=>window.receiptTest.applies),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:["no inference on mount","explicit field application","preserved manual values",
      "changed-field conflict","explicit overwrite","removed receipt cancels pending result","375px layout","light/dark"],screenshots:output}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
