'use strict';
// Read-only exposure audit. Never print secret values or matching lines.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
function git(args){return cp.execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});}
function filesAt(ref){return git(['ls-tree','-r','--name-only',ref]).trim().split('\n').filter(Boolean);}
const sensitivePath=/(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|p12|pfx|jks|keystore|key|kdbx|sqlite|db|bak|sql|dump|log))$/i;
const patterns=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g],
 ['github-access-token',/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
 ['google-api-key',/\bAIza[0-9A-Za-z_-]{35}\b/g],
 ['aws-access-id',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
 ['slack-access-token',/\bxox[baprs]-[A-Za-z0-9-]{15,}\b/g],
 ['generic-assignment',/\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_+\/.=-]{16,}/gi]
];
const whitelist=/^(?:data\/|tests\/|tools\/)/;
let tracked=filesAt('HEAD'), exposure=[], scanned=0, skipped=0;
for(const file of tracked){
 if(sensitivePath.test(file))exposure.push({kind:'sensitive-path',path:file});
 const full=path.join(root,file);
 let stat;try{stat=fs.statSync(full)}catch{continue}
 if(!stat.isFile()||stat.size>5*1024*1024){skipped++;continue}
 const buf=fs.readFileSync(full);
 if(buf.subarray(0,8192).includes(0)){skipped++;continue}
 scanned++;
 const data=buf.toString('utf8');
 for(const [kind,regexp] of patterns){regexp.lastIndex=0;let m,count=0;
   while((m=regexp.exec(data))!==null && count++<20){
     const line=data.slice(0,m.index).split('\n').length;
     exposure.push({kind,path:file,line});
   }
 }
}
const historyFiles=git(['log','--all','--pretty=format:','--name-only']).split('\n').map(x=>x.trim()).filter(Boolean);
const pastSensitive=[...new Set(historyFiles.filter(x=>sensitivePath.test(x)))];
const commits=git(['rev-list','--all','--count']).trim();
const categories={};
for(const x of exposure)categories[x.kind]=(categories[x.kind]||0)+1;
const report={trackedFiles:tracked.length,scannedTextFiles:scanned,skippedBinaryOrLarge:skipped,commitsReachable:Number(commits),historicalFilePathsChecked:historyFiles.length,historySensitivePathCount:pastSensitive.length,findingsByType:categories,findings:exposure.slice(0,50),historySensitivePaths:pastSensitive.slice(0,30),scopeLimitations:['Historical file names checked for all reachable commits; historical blob contents have NOT been scanned','This pattern scan is not a substitute for a dedicated secrets scanner or repository permission review','Potential assignments may be false positives']};
console.log('REPOSITORY EXPOSURE AUDIT — NO MATCHING VALUES PRINTED');
console.log(JSON.stringify(report,null,2));
if(exposure.some(x=>x.kind!=='generic-assignment')||pastSensitive.length)process.exitCode=1;
