const fs = require('fs');
const path = require('path');

function main() {
  const root = path.resolve(__dirname, '..');
  const specPath = path.join(root, 'docs', 'bodymap', 'body-map-asset-spec.md');

  if (!fs.existsSync(specPath)) {
    throw new Error('Missing body-map asset spec: docs/bodymap/body-map-asset-spec.md');
  }

  const raw = fs.readFileSync(specPath, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');

  const required = [
    { name: 'heading: Numeric Proportion Targets', re: /^###\s+Numeric Proportion Targets\b/im },
    { name: 'heading: Zone-by-Zone Coverage Contract', re: /^###\s+Zone-by-Zone Coverage Contract\b/im },
    { name: 'heading: Export Contract', re: /^##\s+Export Contract\b/im },
    { name: 'heading: Screenshot Acceptance Pack', re: /^##\s+Screenshot Acceptance Pack\b/im },
    { name: 'heading: Automatic Fail Conditions', re: /^###\s+Automatic Fail Conditions\b/im },
    { name: 'heading: Camera Presentation Contract', re: /^##\s+Camera Presentation Contract\b/im },
    { name: 'camera split phrase (FRONT/BACK flatter, ORBIT perspective)', re: /orthographic-style[\s\S]{0,240}ORBIT[\s\S]{0,160}perspective/i },
    { name: 'token: 7.25-7.75', re: /7\.25-7\.75/i },
    { name: 'token: BaseBody', re: /\bBaseBody\b/i },
    { name: 'token: no baked glow', re: /no baked glow/i },
    { name: 'token: FRONT/BACK', re: /FRONT\/BACK/i },
    { name: 'token: ORBIT', re: /\bORBIT\b/i },
    { name: 'token: gutters', re: /\bgutters\b/i },
    { name: 'token: hands', re: /\bhands\b/i },
    { name: 'token: feet', re: /\bfeet\b/i },
  ];

  const missing = required.filter((item) => !item.re.test(text));
  if (missing.length > 0) {
    console.error('Body-map asset brief verification failed.');
    for (const item of missing) {
      console.error(`- Missing ${item.name}`);
    }
    process.exit(1);
  }

  console.log('Body-map asset brief verification passed.');
  console.log('- Required headings are present');
  console.log('- Required camera split language is present');
  console.log('- Critical contract tokens are present');
}

main();
