'use strict';
// No network and no deployment. Copy only the reviewed public runtime, never the repository.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
const draft = process.argv.includes('--draft');
const prerelease = process.argv.includes('--prerelease');
if (draft && prerelease) throw Error('Choose draft or public pre-release output, not both.');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const reviewText = /developer review required|requires? (?:[a-z-]+\s+){0,4}review|requires? confirmation|must be confirmed|subject to legal review/i;
fs.rmSync(out, { recursive:true, force:true });
try {
  const cfg = JSON.parse(read('legal/release.json'));
  if (!draft && !prerelease) {
    for (const key of ['copyrightOwner','contactEmail','effectiveDate']) {
      if (typeof cfg[key] !== 'string' || !cfg[key].trim() || /[\[\]{}]/.test(cfg[key])) throw Error('Supply verified legal/release.json: ' + key);
    }
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(cfg.contactEmail)) throw Error('Supply a usable public contact email.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.effectiveDate) || !Number.isFinite(Date.parse(cfg.effectiveDate)) || new Date(cfg.effectiveDate).toISOString().slice(0,10)!==cfg.effectiveDate) throw Error('Set a valid ISO effective date.');
    const reviews = ['ownershipAndAssetProvenance','thirdPartySourceAndLicenseObligations','hostingPrivacyAndRetention','nameLogoAndSponsorClearance','ageJurisdictionAndTermsReview','repositoryIsPrivate'];
    for (const key of reviews) if (cfg.approvals?.[key] !== true) throw Error('Unresolved release review: ' + key);
    for (const page of ['privacy.html','terms.html','credits.html']) {
      const body = read(page).replace(/<!-- DRAFT-START -->[\s\S]*?<!-- DRAFT-END -->/g, '');
      if (reviewText.test(body)) throw Error('Resolve review statements in ' + page + ' before publication.');
    }
  }
  // Verify the exact pinned, unmodified third-party bytes before distributing them.
  for (const entry of JSON.parse(read('vendor/manifest.json'))) {
    if (!entry.path.startsWith('vendor/') || entry.path.includes('..')) throw Error('Unsafe vendor manifest path.');
    if (sha(fs.readFileSync(path.join(root,entry.path))) !== entry.sha256) throw Error('Vendor integrity mismatch: ' + entry.path);
  }
  const write = (p, data) => { const target = path.join(out,p); fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target,data); };
  const copy = (from,to=from) => write(to,fs.readFileSync(path.join(root,from)));
  for (const p of ['favicon.ico','favicon.png','legal/fonts.css','legal/legal.css','legal/clear-data.js']) copy(p);
  for (const entry of JSON.parse(read('vendor/manifest.json'))) copy(entry.path);
  for (const p of fs.readdirSync(path.join(root,'docs/licenses'))) copy('docs/licenses/'+p,'licenses/'+p);
  let html = read('index.html');
  // Remove development-only accessors from the public artifact, leaving gameplay intact.
  html = html.replace(/^window\.(?:__[A-Za-z]+|APEX)\s*=.*\n/gm,'');
  const data = html.match(/const CIRCUIT_DATA = (.*);/);
  if (!data) throw Error('Missing circuit data.');
  write('data/circuit-data.json',JSON.stringify(JSON.parse(data[1]),null,2)+'\n');
  let n = 0;
  html = html.replace(/<script(\s+type="module")?>([\s\S]*?)<\/script>/g, (_,moduleAttr,code) => {
    const name = moduleAttr ? 'game.js' : 'sim.js'; n++;
    write(name,transformSync(code,{loader:'js',target:'es2022',minify:true,legalComments:'inline',...(moduleAttr?{format:'esm'}:{})}).code);
    return '<script'+(moduleAttr?' type="module"':'')+' src="./'+name+'"></script>';
  });
  if (n !== 2) throw Error('Expected the simulation and game scripts.');
  if (draft) html = html.replace('<head>','<head>\n<meta name="robots" content="noindex">').replace('<body>','<body>\n<p style="position:fixed;top:0;left:0;z-index:99999;background:#2b2517;color:#fff;padding:4px 12px;margin:0">LOCAL DRAFT — release review pending</p>');
  write('index.html',html);
  const vars = { COPYRIGHT_OWNER:cfg.copyrightOwner,CONTACT_EMAIL:cfg.contactEmail,EFFECTIVE_DATE:cfg.effectiveDate };
  for (const page of ['privacy.html','terms.html','credits.html']) {
    if (prerelease) {
      write(page,require('./render-prerelease.cjs').renderPrerelease(read(page),page));
      continue;
    }
    let body = read(page).replace(/\{\{([A-Z_]+)\}\}/g,(_,k) => esc(vars[k]));
    if (!draft) body = body.replace(/<!-- DRAFT-START -->[\s\S]*?<!-- DRAFT-END -->/g,'').replace('<meta name="robots" content="noindex">','');
    if (!draft && (/\{\{|\[.*REQUIRED\]/.test(body) || reviewText.test(body))) throw Error('Unresolved legal draft: '+page);
    write(page,body);
  }
  write('release-status.json',JSON.stringify(prerelease?{stage:'release'}:{stage:draft?'local-draft':'reviewed-release',legalReviewComplete:!draft})+'\n');
  write('robots.txt',draft?'User-agent: *\nDisallow: /\n':'User-agent: *\nAllow: /\n');
  console.log((prerelease?'Public release':draft?'LOCAL DRAFT ONLY':'Reviewed release')+' built in dist. No deployment performed.');
} catch (e) {
  fs.rmSync(out,{recursive:true,force:true});
  console.error('Release blocked: '+e.message);
  process.exitCode=1;
}
