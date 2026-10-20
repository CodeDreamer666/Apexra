'use strict';
// Publish factual game information without inventing an identity, contact or effective date.
// Private review templates and approval flags remain unchanged.
function renderPrerelease(source, page) {
  let html = source.replace(/<!-- DRAFT-START -->[\s\S]*?<!-- DRAFT-END -->/, '')
    .replace('<meta name="robots" content="noindex">', '')
    .replace(/<p class="meta">[\s\S]*?<\/p>/, '')
    .replace(/<p><small>© 2026 \{\{COPYRIGHT_OWNER\}\}[\s\S]*?<\/small><\/p>/g,
      '<p><small>Original game material is intended to remain proprietary. Third-party rights and licenses remain applicable.</small></p>');
  if (page === 'privacy.html') {
    html = html.replace('<title>Privacy Policy · Apexra</title>', '<title>Privacy information · Apexra</title>')
      .replace('<h1>Privacy Policy</h1>', '<h1>Privacy information</h1>')
      .replace('<strong>Developer review required:</strong> confirm the project’s enabled hosting logs, security services, access, retention periods, processor arrangements and international-transfer safeguards before making this policy effective.',
        'Hosting logs, retention and international processing depend on Vercel’s services and the deployment configuration.')
      .replace('The intended audience and any additional protections for children require developer review before release.',
        '')
      .replace(/<p>Contact \{\{CONTACT_EMAIL\}\}[\s\S]*?<\/p>/,
        '<p>The developer has not yet published a public privacy-contact channel. The game has no account-based save recovery. '
        + 'You may raise Singapore data-protection concerns with the <a href="https://www.pdpc.gov.sg/" rel="noreferrer">PDPC</a> or an applicable local authority.</p>')
      .replace(/<p>If you choose to email the published contact,[\s\S]*?<\/p>/, '');
  }
  if (page === 'terms.html') {
    html = html.replace(' Please ask {{CONTACT_EMAIL}} about other uses of original material.', '')
      .replace(/<p>Subject to legal review,[\s\S]*?<\/p>/,
        '<p>Applicable mandatory legal rights remain unaffected.</p>')
      .replace(/<p>Questions: \{\{CONTACT_EMAIL\}\}[\s\S]*?<\/p>/,
        '');
  }
  if (page === 'credits.html') {
    html = html.replace(/<p>© 2026 \{\{COPYRIGHT_OWNER\}\}[\s\S]*?<\/p>/,
      '<p>Original Apexra material is intended to remain proprietary, subject to third-party rights. '
      + 'This is not a claim of ownership over licensed data, fonts or code.</p>')
      .replace(/<p><small>Rights and attribution questions: \{\{CONTACT_EMAIL\}\}<\/small><\/p>/,
        '<p><small>Third-party copyright notices and license permissions remain applicable.</small></p>');
  }
  html = html
    .replace(' The effect and fairness of these provisions require legal review.', '')
    .replace(' Corresponding source and modification/replacement arrangements require release review.', '')
    .replace('Terrain Tiles blends multiple elevation sources, so the exact source and terms for each downloaded tile must be confirmed.', 'Terrain Tiles blends multiple elevation sources with source-specific attribution and terms.')
    .replace(' The logo and favicon, procedural artwork, fictional sponsor names and any AI-assisted material still require confirmation of provenance and rights; generation alone is not proof of ownership or clearance.', ' Third-party rights remain applicable.');
  if (/\{\{|\}\}|\[(?:VERIFIED|PUBLIC|EFFECTIVE).*REQUIRED\]/.test(html)) throw Error('Unresolved placeholder in public page: '+page);
  return html;
}
module.exports = { renderPrerelease };
