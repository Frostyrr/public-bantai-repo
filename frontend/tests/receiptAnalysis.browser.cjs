const assert=require("node:assert/strict");
const {mkdtempSync}=require("node:fs");
const {tmpdir}=require("node:os");
const path=require("node:path");
const {chromium}=require("playwright");
async function main(){
  const browser=await chromium.launch({channel:"msedge",headless:true});
  const output=mkdtempSync(path.join(tmpdir(),"bantai-receipt-analysis-"));
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1050}});
    page.setDefaultTimeout(10000);
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    let extractionPosts=0,imagePosts=0,imagesEnabled=false,expensePosts=0,receiptCurrency="PHP",baniEnabled=true,configFailed=false;const chats=[];
    const id="bbbbbbbb-1111-4111-8111-111111111111";
    await page.route("**/*",async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.includes("/organizations/")){
        const cors={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,OPTIONS"};
        if(request.method()==="OPTIONS")return route.fulfill({status:204,headers:cors});
        const respond=data=>route.fulfill({headers:cors,contentType:"application/json",body:JSON.stringify(data)});
        if(url.pathname.endsWith("/ai/images/config"))return respond({enabled:imagesEnabled,receiptEnabled:true});
        if(url.pathname.endsWith("/ai/image-analyses")){
          imagePosts++;assert.match(JSON.parse(request.postData()).question,/Describe this image/);
          return respond({id,expiresAt:new Date(Date.now()+86400000).toISOString(),cached:false,data:{kind:"image",description:"A notice",visibleText:"Meeting Friday 3 PM. Room 204",observations:[],receipt:null,uncertainties:[]},warnings:[]});
        }
        if(url.pathname.endsWith("/receipt-extractions/config"))return configFailed
          ?route.fulfill({status:503,headers:cors,contentType:"application/json",body:JSON.stringify({message:"Synthetic availability failure."})})
          :respond({enabled:true,baniEnabled});
        if(url.pathname.endsWith("/receipt-extractions")){
          extractionPosts++;
          return respond({id,sourceHash:"a".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString(),cached:false,
            data:{merchant:"BANTAI TEST STORE",transactionDate:"2026-11-19",receiptNumber:"TEST-001",currency:receiptCurrency,subtotal:"100.00",tax:"12.00",total:"112.00",paymentMethod:"Cash",
              lineItems:[{description:"Notebook",quantity:"2",unitPrice:"50.00",total:"100.00"}]},warnings:["Review the original receipt before applying fields."]});
        }
        if(url.pathname.endsWith("/ai/conversations"))return respond({conversation:{id,created_by:"11111111-1111-4111-8111-111111111111",title:"Receipt analysis"},conversations:[]});
        if(url.pathname.endsWith("/chat")){
          chats.push(JSON.parse(request.postData()));
          return route.fulfill({headers:cors,contentType:"text/event-stream",body:'data: {"type":"text_delta","data":"The receipt lists 2 notebooks at PHP 50.00 each."}\n\ndata: {"type":"done"}\n\ndata: [DONE]\n\n'});
        }
        if(request.method()==="POST"&&url.pathname.endsWith("/expenses"))expensePosts++;
        return respond({messages:[],hasOlder:false});
      }
      if(url.origin==="http://127.0.0.1:5178"||url.protocol==="data:")return route.continue();
      return route.abort();
    });
    const url="http://127.0.0.1:5178/tests/receiptAnalysisHarness.html";
    await page.goto(url);
    await page.getByRole("heading",{name:"Analyze Receipt",exact:true}).waitFor();
    const receipt={name:"receipt.png",mimeType:"image/png",buffer:Buffer.from(await page.evaluate(()=>window.analysisSyntheticData),"base64")};
    await page.locator("#analyze-receipt-file").setInputFiles(receipt);
    assert.equal(extractionPosts,0,"Attaching makes no extraction request");
    await page.getByRole("button",{name:"Extract",exact:true}).click();
    await page.getByRole("table").waitFor();
    assert.equal(extractionPosts,1);
    await page.getByLabel("Receipt question").fill("Does it include notebooks?");
    await page.getByRole("button",{name:"Ask Bani",exact:true}).click();
    await page.getByText("The receipt lists 2 notebooks at PHP 50.00 each.",{exact:true}).waitFor().catch(async error=>{
      console.error("analysis alerts:",await page.getByRole("alert").allTextContents());await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});throw error;
    });
    await page.getByLabel("Receipt question").fill("How many?");
    await page.getByRole("button",{name:"Ask Bani",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
    assert.equal(extractionPosts,1);assert.equal(chats.length,2);assert.equal(chats[0].receipt.extractionId,id);
    await page.getByRole("heading",{name:"Analyze Receipt",exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,"analyzer-desktop.png"),fullPage:true,animations:"disabled"});
    for(const width of [768,1024]){
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.setViewportSize({width:375,height:850});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>document.documentElement.classList.add("dark"));
    await page.getByRole("heading",{name:"Analyze Receipt",exact:true}).scrollIntoViewIfNeeded();
    assert(await page.getByRole("button",{name:"Re-extract",exact:true}).isEnabled());
    await page.screenshot({path:path.join(output,"analyzer-mobile-dark.png"),fullPage:true,animations:"disabled"});
    await page.getByRole("button",{name:"Expense draft",exact:true}).click();
    await page.getByRole("button",{name:"Use in expense",exact:true}).click();
    const transfer=JSON.parse(await page.getByLabel("Transferred receipt").textContent());
    assert.equal(transfer.name,"receipt.png");assert.equal(transfer.values.amountCentavos,"112.00");assert(transfer.fields.includes("amountCentavos"));assert.equal(expensePosts,0);
    receiptCurrency="USD";await page.goto(url);
    await page.locator("#analyze-receipt-file").setInputFiles(receipt);
    await page.getByRole("button",{name:"Extract",exact:true}).click();
    await page.getByRole("table").waitFor();
    await page.getByRole("button",{name:"Expense draft",exact:true}).click();
    assert(await page.getByRole("checkbox",{name:"Total amount",exact:true}).isDisabled());
    receiptCurrency="PHP";await page.goto(url+"?mode=bani");
    await page.getByLabel("Attach receipt image to Bani").waitFor({state:"attached"});
    const before=extractionPosts;
    await page.getByLabel("Attach receipt image to Bani").setInputFiles(receipt);
    await page.getByRole("textbox").fill("Find the notebook");
    assert.equal(extractionPosts,before);assert(await page.getByTitle("Send Message").isDisabled());
    await page.getByRole("button",{name:"Extract with AI",exact:true}).click();
    await page.getByText("Ready: receipt.png",{exact:true}).waitFor();
    await page.getByTitle("Send Message").click();
    await page.getByText(/The receipt lists 2 notebooks at/).waitFor().catch(async error=>{
      console.error("Bani alerts:",await page.getByRole("alert").allTextContents());await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});console.error("screenshots:",output);throw error;
    });
    const after=extractionPosts;
    await page.getByRole("textbox").fill("What quantity?");await page.getByTitle("Send Message").click();
    await page.waitForFunction(()=>document.querySelector('button[title="Send Message"]'));
    assert.equal(extractionPosts,after);assert.equal(chats.at(-2).receipt.extractionId,id);assert.equal(chats.at(-1).receipt,undefined);
    baniEnabled=false;await page.goto(url+"?mode=bani");
    await page.getByText("Receipt attachments are not enabled yet.",{exact:true}).waitFor();
    assert(await page.getByRole("button",{name:"Attach receipt",exact:true}).isDisabled());
    await page.getByRole("textbox").fill("An ordinary question");assert(await page.getByTitle("Send Message").isEnabled());
    baniEnabled=true;configFailed=true;await page.goto(url+"?mode=bani");
    await page.getByText(/Could not check receipt uploads/).waitFor();
    assert(await page.getByRole("button",{name:"Attach receipt",exact:true}).isDisabled());
    configFailed=false;await page.getByRole("button",{name:"Retry receipt uploads",exact:true}).click();
    await page.locator("button:enabled").filter({hasText:/^Attach receipt$/}).waitFor();
    assert(await page.getByRole("button",{name:"Attach receipt",exact:true}).isEnabled());
    imagesEnabled=true;await page.goto(url+"?mode=bani");
    await page.getByRole("button",{name:"Attach image",exact:true}).waitFor();
    await page.getByLabel("Attach image to Bani",{exact:true}).setInputFiles({...receipt,name:"notice.png"});
    await page.getByAltText("Selected image: notice.png").waitFor();assert.equal(imagePosts,0);
    assert(await page.getByTitle("Send Message").isEnabled());await page.getByTitle("Send Message").click();
    await page.waitForFunction(()=>document.querySelector('button[title="Send Message"]'));
    assert.equal(imagePosts,1);assert.deepEqual(chats.at(-1).image,{analysisId:id,name:"notice.png"});assert.equal(chats.at(-1).receipt,undefined);
    await page.getByRole("textbox").fill("Which room?");await page.getByTitle("Send Message").click();
    await page.waitForFunction(()=>document.querySelector('button[title="Send Message"]'));assert.equal(imagePosts,1);assert.equal(chats.at(-1).image,undefined);
    for(const width of [375,768,1024,1440]){
      await page.setViewportSize({width,height:950});await page.screenshot({path:path.join(output,`bani-images-${width}.png`),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No overflow at ${width}px`);
    }
    assert.equal(expensePosts,0);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:["explicit extraction","receipt item questions","follow-up without vision request","original image handoff","no expense created","currency mismatch blocked","375px dark layout","Bani composer attachment and follow-up","visible disabled attachment control","ordinary chat remains enabled","availability retry restores uploads","general image selection makes zero calls","image-only Send analyzes once","image follow-up reuses context","375/768/1024/1440 image layouts"],screenshots:output}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
