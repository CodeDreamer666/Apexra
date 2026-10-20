'use strict';
// Publish factual pre-release information without inventing an identity, contact or effective date.
// Private review templates and approval flags remain unchanged.
function renderPrerelease(source, page) {
  const notice = '<p class="draft"><strong>Pre-release information — legal review incomplete.</strong> '
    + 'These pages are not finalized legal documents. Operator identity, a public contact and an effective date have not been published. '
    + 'Third-party license permissions and mandatory legal rights remain applicable.</p>';
  let html = source.replace(/<!-- DRAFT-START -->[\s\S]*?<!-- DRAFT-END -->/, notice)
    .replace(/<p class="meta">[\s\S]*?<\/p>/, '<p class="meta">Pre-release information. No effective legal terms have been published.</p>')
    .replace(/<p><small>© 2026 \{\{COPYRIGHT_OWNER\}\}[\s\S]*?<\/small><\/p>/g,
      '<p><small>Original game material is intended to remain proprietary. Third-party rights and licenses remain applicable.</small></p>');
  if (page === 'privacy.html') {
    html = html.replace('<title>Privacy Policy · Apexra</title>', '<title>Privacy information · Apexra</title>')
      .replace('<h1>Privacy Policy</h1>', '<h1>Privacy information</h1>')
      .replace('<strong>Developer review required:</strong> confirm the project’s enabled hosting logs, security services, access, retention periods, processor arrangements and international-transfer safeguards before making this policy effective.',
        'The project’s hosting logs, security services, access, retention periods, processor arrangements and international-transfer safeguards have not yet been confirmed.')
      .replace('The intended audience and any additional protections for children require developer review before release.',
        'The intended audience and any additional protections for children have not yet been confirmed.')
      .replace(/<p>Contact \{\{CONTACT_EMAIL\}\}[\s\S]*?<\/p>/,
        '<p>The developer has not yet published a public privacy-contact channel. The game has no account-based save recovery. '
        + 'You may raise Singapore data-protection concerns with the <a href="https://www.pdpc.gov.sg/" rel="noreferrer">PDPC</a> or an applicable local authority.</p>')
      .replace(/<p>If you choose to email the published contact,[\s\S]*?<\/p>/, '');
  }
  if (page === 'terms.html') {
    html = html.replace('<title>Terms of Use · Apexra</title>', '<title>Pre-release terms information · Apexra</title>')
      .replace('<h1>Terms of Use</h1>', '<h1>Pre-release terms information</h1>')
      .replace(' Please ask {{CONTACT_EMAIL}} about other uses of original material.', '')
      .replace(/<p>Subject to legal review,[\s\S]*?<\/p>/,
        '<p>No finalized governing-law or jurisdiction clause has been published. Applicable mandatory legal rights remain unaffected.</p>')
      .replace(/<p>Questions: \{\{CONTACT_EMAIL\}\}[\s\S]*?<\/p>/,
        '<p>A public contact and effective terms remain to be supplied. This pre-release page does not represent completed legal review.</p>');
  }
  if (page === 'credits.html') {
    html = html.replace(/<p>© 2026 \{\{COPYRIGHT_OWNER\}\}[\s\S]*?<\/p>/,
      '<p>Original Apexra material is intended to remain proprietary, subject to third-party rights. '
      + 'This is not a claim of ownership over licensed data, fonts or code.</p>')
      .replace(/<p><small>Rights and attribution questions: \{\{CONTACT_EMAIL\}\}<\/small><\/p>/,
        '<p><small>Third-party copyright notices and license permissions remain applicable.</small></p>');
  }
  if (/\{\{|\}\}|\[(?:VERIFIED|PUBLIC|EFFECTIVE).*REQUIRED\]/.test(html)) throw Error('Unresolved placeholder in public pre-release page: '+page);
  return html;
}
module.exports = { renderPrerelease };
