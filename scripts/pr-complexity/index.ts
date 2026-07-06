import { Octokit } from "octokit";

const OWNER = requireEnv("OWNER");
const REPO = requireEnv("REPO");
const PR_NUMBER = Number(requireEnv("PR_NUMBER"));
const PR_AUTHOR = requireEnv("PR_AUTHOR");
const GITHUB_TOKEN = requireEnv("GITHUB_TOKEN");

const COMPLEXITY_LABELS = [
  {
    name: "complexity: low",
    color: "0e8a16",
    description: "Low-complexity PR",
  },
  {
    name: "complexity: medium",
    color: "fbca04",
    description: "Medium-complexity PR",
  },
  {
    name: "complexity: high",
    color: "e4691a",
    description: "High-complexity PR",
  },
  {
    name: "complexity: critical",
    color: "b60205",
    description: "Critical-complexity PR",
  },
];

const FILE_SCORE_WEIGHT = 2;
const FILE_SCORE_CAP = 30;
const LINE_SCORE_BUCKET_SIZE = 50;
const LINE_SCORE_WEIGHT = 3;
const LINE_SCORE_BUCKET_CAP = 20;
const EXPERIENCE_DISCOUNT_CAP = 20;
const TEST_COVERAGE_BONUS = 10;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

type PullFile = {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
};

async function main() {
  if (!Number.isInteger(PR_NUMBER) || PR_NUMBER < 1) {
    throw new Error("PR_NUMBER must be a positive integer");
  }

  const files = await listPullFiles();
  const fileCount = files.length;
  const linesChanged = files.reduce((sum, file) => sum + file.changes, 0);
  const hasTests = files.some((file) => isTestFile(file.filename));
  const authorMergedPRCount = await getAuthorMergedPRCount();

  const fileScore = Math.min(fileCount, FILE_SCORE_CAP) * FILE_SCORE_WEIGHT;
  const lineScore =
    Math.min(
      Math.floor(linesChanged / LINE_SCORE_BUCKET_SIZE),
      LINE_SCORE_BUCKET_CAP
    ) * LINE_SCORE_WEIGHT;
  const experienceDiscount = Math.min(
    authorMergedPRCount,
    EXPERIENCE_DISCOUNT_CAP
  );
  const testBonus = hasTests ? TEST_COVERAGE_BONUS : 0;
  const score = fileScore + lineScore - experienceDiscount - testBonus;
  const label = labelForScore(score);

  await ensureComplexityLabels();
  await replaceComplexityLabel(label.name);

  console.log(`Applied ${label.name} to #${PR_NUMBER} (score: ${score})`);
  console.log(
    `  files: ${fileCount} (+${fileScore}), lines: ${linesChanged} (+${lineScore})`
  );
  console.log(
    `  experience: ${authorMergedPRCount} (-${experienceDiscount}), tests: ${hasTests} (-${testBonus})`
  );
}

async function listPullFiles(): Promise<PullFile[]> {
  return octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: OWNER,
    repo: REPO,
    pull_number: PR_NUMBER,
    per_page: 100,
  });
}

async function getAuthorMergedPRCount(): Promise<number> {
  const query = `repo:${OWNER}/${REPO} is:pr is:merged author:${PR_AUTHOR}`;
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 1,
  });
  return data.total_count;
}

async function ensureComplexityLabels() {
  await Promise.all(
    COMPLEXITY_LABELS.map((l) => ensureLabel(l.name, l.color, l.description))
  );
}

async function ensureLabel(name: string, color: string, description: string) {
  try {
    await octokit.rest.issues.createLabel({
      owner: OWNER,
      repo: REPO,
      name,
      color,
      description,
    });
  } catch (error) {
    if (isOctokitError(error, 422)) {
      await octokit.rest.issues.updateLabel({
        owner: OWNER,
        repo: REPO,
        name,
        color,
        description,
      });
      return;
    }
    if (isOctokitError(error, 403)) {
      return;
    }
    throw error;
  }
}

async function replaceComplexityLabel(nextLabel: string) {
  const { data: issue } = await octokit.rest.issues.get({
    owner: OWNER,
    repo: REPO,
    issue_number: PR_NUMBER,
  });
  const labels = issue.labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((name): name is string => Boolean(name));

  await Promise.all(
    labels
      .filter((label) => label.startsWith("complexity:") && label !== nextLabel)
      .map((label) => removeLabelIfPresent(label))
  );

  if (!labels.includes(nextLabel)) {
    await octokit.rest.issues.addLabels({
      owner: OWNER,
      repo: REPO,
      issue_number: PR_NUMBER,
      labels: [nextLabel],
    });
  }
}

async function removeLabelIfPresent(label: string) {
  try {
    await octokit.rest.issues.removeLabel({
      owner: OWNER,
      repo: REPO,
      issue_number: PR_NUMBER,
      name: label,
    });
  } catch (error) {
    if (!isOctokitError(error, 404)) {
      throw error;
    }
  }
}

function labelForScore(score: number) {
  if (score < 15) return COMPLEXITY_LABELS[0];
  if (score < 35) return COMPLEXITY_LABELS[1];
  if (score < 60) return COMPLEXITY_LABELS[2];
  return COMPLEXITY_LABELS[3];
}

function isTestFile(filename: string): boolean {
  return (
    /(^|\/)(test|tests|__tests__)\//.test(filename) ||
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filename)
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isOctokitError(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
