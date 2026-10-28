'use strict';
// Browser regression check for the generated Curry Records CSP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const file = path.resolve(__dirname, '..', 'curry-record.html');
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
const hashes = scripts.map(m => "'sha256-" + crypto.createHash('sha256')
  .update(m[2].replace(/\r\n?/g,'\n'),'utf8').digest('base64') + "'");

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const requests=[], errors=[], cspErrors=[];
  page.on('request', r => {if(/^https?:/i.test(r.url())) requests.push('external request');});
  page.on('pageerror', e => errors.push(e.message.slice(0,120)));
  page.on('console', m => {
    if(m.type()==='error' && /content security policy|refused to (?:load|execute)/i.test(m.text())) cspErrors.push('CSP console error');
  });
  try {
    await page.goto(pathToFileURL(file).href,{waitUntil:'load',timeout:60000});
    await page.waitForTimeout(400);
    const state = await page.evaluate(()=>{
      const csp=document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')||'';
      const images=[...document.querySelectorAll('img')];
      return {
        title:document.title,
        csp,
        scripts:document.querySelectorAll('script:not([src])').length,
        domElements:document.querySelectorAll('*').length,
        images:images.length,
        blankLinkIssues:document.querySelectorAll('a[target="_blank"]:not([rel~="noopener"])').length,
        activeEmbeds:document.querySelectorAll('object,iframe,embed').length
      };
    });
    assert(state.title.length>0,'Title missing');
    assert(state.csp.includes("default-src 'none'"),'Default deny not set');
    assert(state.csp.includes("connect-src 'none'"),'External communication not blocked');
    assert(state.csp.includes("script-src-attr 'none'"),'Inline handlers not blocked');
    assert.equal(state.scripts,2,'Inline scripts missing');
    assert.equal(hashes.length,2,'Expected exactly two script hashes');
    for(const hash of hashes) assert(state.csp.includes(hash),'Inline script hash not present');
    assert(!/script-src\s+[^;]*'unsafe-inline'/i.test(state.csp),'Inline JS unrestricted');
    assert(state.domElements>=1100,'Page content unexpectedly missing');
    assert(state.images>=100,'Images unexpectedly missing');
    assert.equal(state.blankLinkIssues,0,'New-tab link isolation issue');
    assert.equal(state.activeEmbeds,0,'Unexpected embedded active content');
    const search=page.locator('input[type="search"],input[type="text"]');
    const searchCount=await search.count();
    if(searchCount){
      await search.first().fill('__curry_security_probe_no_match__');
      await search.first().fill('');
      await page.waitForTimeout(200);
    }
    assert.deepEqual(requests,[],'External requests detected');
    assert.deepEqual(errors,[],'JavaScript runtime errors detected');
    assert.deepEqual(cspErrors,[],'Browser CSP violations detected');
    console.log('PASS: CSP hashes, page rendering, image/element counts, link protection, local-only operation, JS runtime and search smoke');
    console.log(JSON.stringify({inlineScripts:state.scripts,images:state.images,domElements:state.domElements,searchInputsTested:searchCount?1:0}));
  }finally{await browser.close();}
})().catch(error=>{console.error('FAIL: '+error.message);process.exitCode=1;});
