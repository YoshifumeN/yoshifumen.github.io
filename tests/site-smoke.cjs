'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const pages=['index.html','research.html','publications.html','presentations.html','cv.html','beyond-the-lab.html','research-grants-calendar.html','food-discoveries.html','poster-eef2023.html','poster-jswe2017.html','poster-jswe2018.html','poster-wet2019.html','poster-wet2021.html','poster-wet2022.html'];
(async()=>{
 const browser=await chromium.launch({headless:true});let tested=0;
 try{
  for(const file of pages){
   const page=await browser.newPage();
   const errors=[],violations=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error' && /content security policy|refused to load|refused to execute/i.test(m.text()))violations.push(m.text())});
   page.on('request',req=>{if(/^https?:/.test(req.url()))violations.push('Unsolicited external request: '+req.url())});
   await page.goto('file://'+path.join(root,file),{waitUntil:'load'});
   assert(await page.locator('body').count(),file+': no body');
   const title=await page.title();assert(title.length>0,file+': missing title');
   const policy=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
   assert(policy&&policy.includes("default-src 'none'"),file+': CSP missing');
   assert(policy.includes("connect-src 'none'")||file==='food-discoveries.html',file+': network restriction missing');
   const bad=await page.locator('a[target="_blank"]:not([rel~="noopener"])').count();
   assert.equal(bad,0,file+': unprotected external blank links');
   if(file==='research-grants-calendar.html'){
    assert((await page.locator('#rows .entry').count())>5,'Research grants calendar did not render');
   }
   if(file==='food-discoveries.html'){
    assert((await page.locator('#world-map').count())===1,'Food map missing');
   }
   assert.deepEqual(errors,[],file+': JavaScript errors: '+errors.join(' | '));
   assert.deepEqual(violations,[],file+': CSP errors: '+violations.join(' | '));
   await page.close();tested++;
  }
  console.log('PASS: '+tested+' pages load without JS errors, CSP violations or unprotected blank links');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
