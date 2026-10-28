'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'research-visualizer.html'),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
assert(script && script.length > 100000, 'Expected main inline application script');
new vm.Script(script, { filename: 'research-visualizer.js' });
assert(html.includes("connect-src 'none'"), 'Local data app must not fetch external resources');
assert(html.includes('function safeSvgXml(source)'), 'Missing allowlist SVG sanitizer');
assert.equal((script.match(/new XMLSerializer\(\)\.serializeToString/g)||[]).length,1,'Unsafe SVG export path remains');

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({acceptDownloads:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const externalRequests=[];
  page.on('request',r=>{
    if(/^https?:/i.test(r.url()))externalRequests.push(r.url());
  });
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rv-security-'));
  async function checkDownload(button,extension){
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:20000}),page.locator(button).click()]);
    const destination=path.join(tmp,'output'+extension);
    await download.saveAs(destination);
    const data=fs.readFileSync(destination);
    assert(data.length>90, 'Downloaded file is empty: '+button);
    if(extension==='.svg'){
      const xml=data.toString('utf8');
      assert(xml.includes('<svg'),'Missing SVG root');
      assert(!/<script|<foreignObject|\sonload=|javascript:/i.test(xml),'SVG contains active code');
    }
    if(extension==='.png')assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG signature invalid');
    return destination;
  }
  try{
    await page.goto(pathToFileURL(path.join(root,'research-visualizer.html')).href,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof window.safeSvgXml==='function');
    assert((await page.locator('#plot').count())===1,'Main plot missing');
    await page.evaluate(()=>{
      const svg=document.getElementById('plot'), ns='http://www.w3.org/2000/svg';
      const unsafe=document.createElementNS(ns,'script');unsafe.textContent='alert("injected")';svg.append(unsafe);
      const foreign=document.createElementNS(ns,'foreignObject');svg.append(foreign);
      const group=document.createElementNS(ns,'g');group.setAttribute('onload','alert(1)');group.setAttribute('fill','url(https://evil.example/a)');svg.append(group);
      const result=window.safeSvgXml(svg);
      if(/<script|foreignObject|onload=|evil\.example|javascript:/i.test(result))throw Error('Unsafe exported SVG');
      unsafe.remove();foreign.remove();group.remove();
    });
    await checkDownload('#exportsvg','.svg');
    await checkDownload('#exportpng','.png');
    await page.locator('#file').setInputFiles({
      name:'rssct.csv',mimeType:'text/csv',
      buffer:Buffer.from('BV,PFAS\n0,10\n100,5\n','utf8')
    });
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('1ファイルを読み込みました'));
    assert((await page.locator('#source option').allTextContents()).some(x=>x.includes('rssct.csv')),'CSV not imported');
    await page.locator('#file').setInputFiles(path.join(root,'tests','fixtures','sample.xlsx'));
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('1ファイルを読み込みました'));
    assert((await page.locator('#source option').allTextContents()).some(x=>x.includes('sample.xlsx')),'XLSX not imported');
    await page.locator('#file').setInputFiles(path.join(root,'tests','fixtures','bomb.xlsx'));
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('読み込み失敗'));
    assert((await page.locator('#status').textContent()).includes('サイズ'),'Zip bomb was not rejected by size validation');
    await checkDownload('#savesettings','.json');
    await page.locator('#loadsettings').setInputFiles({
      name:'oversized.json',mimeType:'application/json',
      buffer:Buffer.alloc(6*1024*1024,0x20)
    });
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('5 MB'));
    await page.locator('#tab-figure').click();
    await checkDownload('#figure-svg','.svg');
    await checkDownload('#figure-png','.png');
    assert.deepEqual(externalRequests,[],'Unexpected external requests: '+externalRequests.join(','));
    assert.deepEqual(errors,[],'JavaScript errors: '+errors.join(' | '));
    console.log('PASS: JS syntax, CSP, sanitizer, SVG/PNG/JSON downloads, CSV/XLSX import, ZIP bomb and JSON size rejection');
  }finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(err=>{console.error(err);process.exitCode=1;});
