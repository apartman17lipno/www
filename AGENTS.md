# AGENTS.md

These instructions apply to AI coding agents working in this repository.

## 1. General working principles

- First inspect the existing project structure and understand the relevant code before editing.
- Follow the project's existing architecture, naming conventions, formatting, and coding style.
- Prefer the smallest safe change that fully solves the requested task.
- Do not rewrite, refactor, or reformat unrelated code.
- Do not introduce new dependencies unless necessary; explain why before adding one.
- Do not assume a framework, runtime, or command. Inspect the repository and its configuration first.
- If an important requirement is ambiguous, ask before making risky changes.

## 2. Protect existing work

- Before editing, inspect `git status` and the current branch.
- Never overwrite, discard, reset, or modify unrelated uncommitted user changes.
- Do not run destructive commands such as `git reset --hard`, `git clean`, or bulk deletion unless explicitly requested.
- Do not change secrets, credentials, production data, or environment-specific configuration.
- Never put API keys, passwords, tokens, or personal/customer data in source code, logs, commits, or prompts.
- Do not reveal secret values from files such as `.env`.

## 3. Implementation workflow

For each task:

1. Understand the request and inspect the relevant files.
2. Trace how the existing feature works before changing it.
3. Identify the files that need to change.
4. Make the smallest appropriate implementation.
5. Review the complete diff for correctness and unrelated changes.
6. Run the most relevant available tests, lint, type checks, or build.
7. Report what changed, which checks ran, and any remaining risks.

- Never claim a check passed unless it was actually run and succeeded.
- If a check cannot be run or fails, explain why.
- Do not hide test or build failures.

## 4. Git branch, commit and push policy

Working branch: `DEVELOP`.

- Work only on the `DEVELOP` branch. If another branch is checked out, switch with `git switch DEVELOP` (inspect `git status` first and never discard uncommitted changes).
- **At the start of every task, run `git pull --rebase origin DEVELOP` automatically, without asking the user.**
- Do not commit or push before reviewing the diff and running relevant checks.
- After a task is complete and relevant checks pass, create a local Git commit.
- Use a short, descriptive commit message.
- Include only files related to the requested task. Preserve unrelated user changes.
- **After each commit, run `git push origin DEVELOP` automatically, without asking the user for approval.**
- If the pull or push fails (conflict, rejected push, authentication error), stop, explain the problem, and do not overwrite anything.
- Never push to `main` directly and never merge into `main`. `main` (PROD) is updated only through a pull request reviewed and merged by the user after testing on TEST.
- Never use `git push --force` or rewrite shared history unless explicitly requested and the consequences are confirmed.
- Before committing, check `git status` and make sure no secrets, tokens, `.clasp.json`, `.clasprc.json`, or `.env` files are included.
- If tests fail or the diff contains unrelated changes, do not commit; explain the situation and ask how to proceed.

## 5. Deployment pipeline (TEST and PROD)

- **TEST frontend (`www-test`)**: Every push to `DEVELOP` triggers `.github/workflows/mirror-test.yml`, which mirrors `DEVELOP` to `apartman17lipno/www-test` (`main`) without `CNAME` and deploys the TEST frontend via GitHub Pages.
- **TEST backend (Google Apps Script)**: Every push to `DEVELOP` that modifies `google-apps-script/**` triggers `.github/workflows/deploy-gas-test.yml`, which pushes `google-apps-script/` via `clasp` and updates the TEST Apps Script deployment.
- **PROD (`www` and PROD Apps Script)**: After verifying on TEST, the user manually merges a pull request from `DEVELOP` into `main`. Merging into `main` updates the production site via GitHub Pages (`apartman17lipno.cz`), and if `google-apps-script/**` changed, `.github/workflows/deploy-gas-prod.yml` updates the PROD Apps Script deployment.
- AI agents never deploy directly to PROD or touch `main`. When a task modifies `google-apps-script/**`, explicitly mention in the final summary that backend deployment workflows are affected.

## 6. Scope and communication

- Keep the user informed before high-impact changes, data migrations, dependency upgrades, or changes involving authentication, payments, invoicing, reservations, or customer data.
- Do not invent business, tax, invoice-numbering, or reservation rules. Ask when they are not defined.
- For user-facing changes, preserve the application's existing language and terminology.
- At the end, provide:
  - a concise summary of the implementation;
  - the files changed;
  - whether `google-apps-script/**` was modified (and thus GAS TEST deploy will trigger);
  - the checks run and their results;
  - the commit hash, if a commit was created;
  - whether the push to `DEVELOP` succeeded.

## 7. Project documentation

- When a change materially affects architecture, setup, configuration, or user workflows, update the relevant documentation.
- Avoid duplicate documentation when an appropriate document already exists.
- Keep documentation factual and consistent with the implementation.
