const test = require('node:test'); const assert = require('node:assert');
const F = require('../js/fairness.js');
test('flags protected characteristics and proxies in job text', () => {
  const cats = (s) => F.check(s).map((f) => f.category);
  assert.ok(cats('Looking for young digital natives').includes('age'));
  assert.ok(cats('Native English speaker required').includes('origin'));
  assert.ok(cats('Recent graduates only').includes('age'));
  assert.ok(cats('Must not have kids or family plans').includes('family'));
  assert.ok(cats('Strong culture fit').includes('proxy'));
  assert.ok(cats('Salesman wanted, he will travel').includes('gender'));
  assert.ok(cats('Church members preferred').includes('religion'));
  assert.ok(cats('No more than 10 years of experience').includes('age'));
});
test('does not flag ordinary job language', () => {
  for (const s of ['5+ years with React and TypeScript', 'Blind screening is on', 'Single sign-on and single-page apps', 'Whiteboard exercise', 'Manage stakeholders', 'Weight 20']) assert.deepStrictEqual(F.check(s), [], s);
});
test('blind mode removes identity, contact, address, graduation years, pronouns and self-disclosed details', () => {
  const r = F.blind('Maria Lopez\nmaria.lopez@mail.example | (555) 201-3344 | linkedin.com/in/marialopez\n12 Elm Street, Austin, TX 78701\nPronouns: she/her\n\n## Experience\nMaria led the migration; she mentored 4 engineers, 2019 - 2022.\nPresident, Women in Engineering Society\n\n## Education\nB.S. Computer Science, State University, 2012\nMarried, two children.', { name: 'Maria Lopez' });
  for (const bad of ['Maria', 'Lopez', 'mail.example', '201-3344', 'linkedin', 'Elm Street', '78701', 'she', '2012', 'Married', 'Women']) assert.ok(!r.text.includes(bad), bad + ' leaked: ' + r.text);
  assert.match(r.text, /mentored 4 engineers, 2019 - 2022/, 'work dates stay');
  assert.ok(r.redactions.length >= 8);
});
