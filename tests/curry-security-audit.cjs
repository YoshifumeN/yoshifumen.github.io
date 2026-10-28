'use strict';
// Read-only baseline security audit for the large, standalone Curry Records page.
// No page contents, photographs, or visit records are printed to CI logs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const file = path.resolve(__dirname, '..', 'curry-record.html');
const html = fs.readFileSync(file, 'utf8');
const warnings = [];
const failures = [];
const count = expression => (html.match(expression) || []).length;

(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const requests = [], pageErrors = [], cspErrors = [];
  page.on('request', r => {if (/^https?:/i.test(r.url())) requests.push(new URL(r.url()).hostname);});
  page.on('pageerror', e => pageErrors.push(e.message.slice(0,120)));
  page.on('console', m => {
    if (m.type() === 'error' && /content security policy|refused to (?:load|execute)/i.test(m.text())) cspErrors.push('browser rejected a resource');
  });
  try {
    await page.goto(pathToFileURL(file).href, {waitUntil:'load', timeout:60000});
    const report = await page.evaluate(() => {
      const q = selector => [...document.querySelectorAll(selector)];
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '';
      const blankLinks = q('a[target="_blank"]').filter(a => !a.relList.contains('noopener'));
      const dangerousLinks = q('a[href]').filter(a => /^\\s*javascript:/i.test(a.getAttribute('href')));
      const activeContent = q('iframe,object,embed');
      const inlineHandlers = q('*').reduce((total, el) => total +
        [...el.attributes].filter(a => /^on[a-z]+$/i.test(a.name)).length, 0);
      const externalScripts = q('script[src]').filter(s => /^https?:/i.test(s.src));
      return {
        hasBody: !!document.body,
        titlePresent: !!document.title.trim(),
        hasCsp: !!csp,
        hasDefaultDeny: /(?:^|;)\\s*default-src\\s+'none'/i.test(csp),
        hasConnectDeny: /(?:^|;)\\s*connect-src\\s+'none'/i.test(csp),
        inlineScripts: q('script:not([src])').length,
        externalScripts: externalScripts.length,
        activeContent: activeContent.length,
        blankLinks: q('a[target="_blank"]').length,
        unprotectedBlankLinks: blankLinks.length,
        javascriptLinks: dangerousLinks.length,
        inlineHandlers,
        images: q('img').length,
        domElements: q('*').length
      };
    });
    const hints = {
      evalCalls: count(/\\beval\\s*\\(/g),
      functionConstructors: count(/\\bnew\\s+Function\\s*\\(/g),
      documentWrites: count(/\\bdocument\\.write\\s*\\(/g),
      innerHtmlAssignments: count(/\\.innerHTML\\s*=/g),
      networkApiMentions: count(/\\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\\b/g)
    };
    console.log('Curry Records baseline audit (no user records printed)');
    console.log(JSON.stringify({sourceBytes:Buffer.byteLength(html,'utf8'), browser:report, heuristicSourceCounts:hints,
      externalRequestHosts:[...new Set(requests)], pageErrorCount:pageErrors.length,cspErrorCount:cspErrors.length}, null, 2));
    if (!report.hasBody || !report.titlePresent) failures.push('Page failed basic loading checks');
    if (!report.hasCsp) failures.push('CSP is missing');
    else if (!report.hasDefaultDeny) warnings.push('CSP is present but lacks default-src none');
    if (report.externalScripts) failures.push('Page loads external JavaScript');
    if (report.activeContent) warnings.push('Iframe/object/embed elements require manual review');
    if (report.unprotectedBlankLinks) failures.push('New-window links lack rel=noopener');
    if (report.javascriptLinks) failures.push('javascript: hyperlinks exist');
    if (report.inlineHandlers) warnings.push('Inline event handlers present; evaluate safe CSP strategy');
    if (requests.length) failures.push('Browser requested external HTTP(S) resources');
    if (pageErrors.length) warnings.push('Browser JavaScript errors occurred');
    if (cspErrors.length) warnings.push('Browser reported CSP violations');
    if (hints.evalCalls || hints.functionConstructors || hints.documentWrites || hints.innerHtmlAssignments)
      warnings.push('Potentially active DOM/JS APIs: inspect source before drawing conclusions');
    for (const x of warnings) console.log('REVIEW: ' + x);
    for (const x of failures) console.error('ACTION REQUIRED: ' + x);
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error('Audit could not complete:', error.message); process.exitCode = 1; });
