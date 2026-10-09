import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/deploy-tools.yml', import.meta.url),
  'utf8',
);
const workflowLines = workflow.split(/\r?\n/);
const jobsLine = workflowLines.indexOf('jobs:');
assert.notEqual(jobsLine, -1, 'workflow must define jobs');
const jobNames = workflowLines
  .slice(jobsLine + 1)
  .filter((line) => /^  [A-Za-z0-9_-]+:$/.test(line))
  .map((line) => line.trim().slice(0, -1));

function jobSource(name) {
  const start = workflowLines.findIndex(
    (line, index) => index > jobsLine && line === `  ${name}:`,
  );
  assert.notEqual(start, -1, `workflow must define the ${name} job`);

  const nextJob = workflowLines.findIndex(
    (line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line),
  );
  return workflowLines
    .slice(start, nextJob === -1 ? workflowLines.length : nextJob)
    .join('\n');
}

const triggerSource = workflowLines
  .slice(0, workflowLines.indexOf('permissions:'))
  .join('\n');
const checksJob = jobSource('checks');
const stagingJob = jobSource('staging');

test('main pushes and pull requests run native checks without deploying', () => {
  assert.deepEqual(jobNames, ['checks', 'staging']);
  assert.match(triggerSource, /^  push:\n    branches:\n      - main$/m);
  assert.match(triggerSource, /^  pull_request:\n    branches:\n      - main$/m);
  assert.doesNotMatch(checksJob, /^\s+if:/m);
  assert.match(checksJob, /run: bash scripts\/gatekeeper\.sh/);
  assert.doesNotMatch(checksJob, /deploy|cloudflare|wrangler/i);
});

test('manual dispatch can deploy only to staging and stores its candidate', () => {
  assert.match(triggerSource, /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(triggerSource, /^\s+inputs:/m);
  assert.match(
    stagingJob,
    /if: \$\{\{\s*github\.event_name == 'workflow_dispatch'\s*\}\}/,
  );
  assert.match(stagingJob, /node-version: 22/);
  assert.match(stagingJob, /needs: checks/);
  assert.match(stagingJob, /run: npm ci/);
  assert.match(stagingJob, /run: npm run deploy:execute:staging/);
  assert.match(
    stagingJob,
    /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/,
  );
  assert.match(
    stagingJob,
    /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/,
  );
  assert.match(stagingJob, /contents: write/);
  assert.match(stagingJob, /git config user\.name "github-actions\[bot\]"/);
  assert.match(stagingJob, /uses: actions\/upload-artifact@v4/);
  assert.match(stagingJob, /name: tools-staging-candidate-\$\{\{ github\.sha \}\}/);
  assert.match(stagingJob, /path: \.deploy\//);
  assert.match(stagingJob, /include-hidden-files: true/);
  assert.match(stagingJob, /if-no-files-found: error/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /\bproduction\b|deploy:execute:production/i);
});
