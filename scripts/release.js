/* global __dirname process require */

const chalk = require('chalk');
const {execSync} = require('child_process');
const minimist = require('minimist');
const path = require('path');
const {prompt} = require('promptly');
const semver = require('semver');

const args = minimist(process.argv.slice(2));
const lernaJson = require(path.join(__dirname, '../lerna.json'));

const DEFAULT_COMMIT_MSG = `chore(release): %v`;
const commitMsg = args['commit-message'] || DEFAULT_COMMIT_MSG;

const DEFAULT_DIST_TAG = `latest`;
const distTag = args['dist-tag'] || DEFAULT_DIST_TAG;

const DEFAULT_GIT_BRANCH = `master`;
const branch = args['git-branch'] || DEFAULT_GIT_BRANCH;

const DEFAULT_GIT_REMOTE = `origin`;
const remote = args['git-remote'] || DEFAULT_GIT_REMOTE;

let DEFAULT_PRE_ID;
const prerelease = semver(lernaJson.version).prerelease;
if (prerelease.length > 1) {
  DEFAULT_PRE_ID = prerelease[0];
}
const preId = args.preid || DEFAULT_PRE_ID;

const DEFAULT_REGISTRY = lernaJson.command.publish.registry;
const registry = args.registry || DEFAULT_REGISTRY;

const DEFAULT_SIGN = false;
const sign = args.sign || DEFAULT_SIGN;

const bump = args._[0];

const cyan = (str) => chalk.cyan(str);
const execSyncInherit = (cmd) => execSync(cmd, {stdio: 'inherit'});
const log = (mark, str) => console.log(mark, str.filter(s => !!s).join(` `));
const logError = (...str) => log(chalk.red(`✘`), str);
const logInfo = (...str) => log(chalk.blue(`ℹ`), str);
const logSuccess = (...str) => log(chalk.green(`✔`), str);

const reportSetting = (desc, val, def) => {
  logInfo(`${desc} is set to ${cyan(val)}${val === def ? ` (default).`: `.`}`);
};

const runCommand = (cmd, inherit = true, display) => {
  logInfo(`Running command ${cyan(display || cmd)}.`);
  let out;
  if (inherit) {
    execSyncInherit(cmd);
  } else {
    out = execSync(cmd);
  }
  return out;
};

(async () => {
  try {
    logInfo(`Checking the working tree...`);

    try {
      runCommand(`npm run --silent cwtree`, true, `npm run cwtree`);
      logSuccess(`Working tree is clean.`);
    } catch (e) {
      logError(
        `Working tree is dirty or has untracked files.`,
        `Please make necessary changes or commits before rerunning this script.`
      );
      throw new Error();
    }

    reportSetting(`Release branch`, branch, DEFAULT_GIT_BRANCH);
    logInfo(`Determining the current branch...`);

    let currentBranch;
    try {
      currentBranch = runCommand(`git rev-parse --abbrev-ref HEAD`, false)
        .toString()
        .trim();
    } catch (e) {
      logError(`Couldn't determine the branch. Please check the error above.`);
      throw new Error();
    }

    if (currentBranch === branch) {
      logSuccess(`Current branch and release branch are the same.`);
    } else {
      logError(
        `Current branch ${cyan(currentBranch)} is not the same as release`,
        `branch ${cyan(branch)}. Please checkout the release branch before`,
        `rerunning this script or rerun with`,
        `${cyan(`--git-branch ${currentBranch}`)}.`
      );
      throw new Error();
    }

    reportSetting(`Git remote`, remote, DEFAULT_GIT_REMOTE);
    logInfo(
      `Fetching commits from ${cyan(remote)}`,
      `to compare local and remote branches...`
    );

    try {
      runCommand(`git fetch ${remote}`);
    } catch (e) {
      logError(`Couldn't fetch latest commits. Please check the error above.`);
      throw new Error();
    }

    let localRef, remoteRef;
    try {
      localRef = runCommand(`git rev-parse ${branch}`, false).toString();
      remoteRef = (
        runCommand(`git rev-parse ${remote}/${branch}`, false).toString()
      );
    } catch (e) {
      logError(`A problem occured. Please check the error above.`);
      throw new Error();
    }

    if (localRef === remoteRef) {
      logSuccess(`Local branch is in sync with remote branch.`);
    } else {
      logError(
        `Local branch ${cyan(branch)} is not in sync with`,
        `${cyan(`${remote}/${branch}`)}.`,
        `Please sync branches before rerunning this script.`
      );
      throw new Error();
    }

    logInfo(
      `It's time to prepare for and run the QA suite, this will take awhile...`
    );

    try {
      runCommand(`npm run prepare:qa`);
      logSuccess(`All steps succeeded when preparing for the QA suite.`);
    } catch (e) {
      logError(`A step failed in the QA suite. Please check the error above.`);
      throw new Error();
    }

    try {
      runCommand(`npm run qa`);
      logSuccess(`All steps succeeded in the QA suite.`);
    } catch (e) {
      logError(`A step failed in the QA suite. Please check the error above.`);
      throw new Error();
    }

    logInfo(`Versioning with Lerna...`);
    reportSetting(`Commit message format`, commitMsg, DEFAULT_COMMIT_MSG);
    reportSetting(`Prerelease identifier`, preId, DEFAULT_PRE_ID);
    reportSetting(`Signature option`, sign, DEFAULT_SIGN);

    const lernaVersion = [
      `lerna version`,
      bump || ``,
      `--conventional-commits`,
      `--git-remote ${remote}`,
      `--message ${commitMsg}`,
      `--no-push`,
      preId && `--preid ${preId}`,
      `--sign-git-commit ${sign}`,
      `--sign-git-tag ${sign}`
    ].filter(str => !!str).join(` `);

    try {
      runCommand(lernaVersion);
      logSuccess(`Successfully bumped the version.`);
    } catch (e) {
      logError(`Couldn't bump the version. Please check the error above.`);
      throw new Error();
    }

    //
    process.exit(0);
    //

    logInfo(`Publishing with Lerna...`);
    reportSetting(`Package distribution tag`, distTag, DEFAULT_DIST_TAG);
    reportSetting(`Package registry`, registry, DEFAULT_REGISTRY);

    const lernaPublish = [
      `lerna publish`,
      `from-git`,
      `--dist-tag ${distTag}`,
      `--no-git-reset`,
      `--registry ${registry}`
    ].join(` `);

    try {
      runCommand(lernaPublish);
      logSuccess(`Successfully published the new version.`);
    } catch (e) {
      logError(
        `Couldn't publish the new version. Please check the error above.`,
      );
      throw new Error();
    }

    logInfo(
      `Pushing release commit and tag to remote ${cyan(remote)} on branch`,
      `${cyan(branch)}...`
    );

    const gitPush = `git push --follow-tags ${remote} ${branch}`;

    try {
      runCommand(gitPush);
      logSuccess(`Successfully pushed.`);
    } catch (e) {
      logError(`Couldn't push. Please check the error above.`);
      throw new Error();
    }

    logSuccess(`${chalk.green(`RELEASE SUCCEEDED!`)} Woohoo! Done.`);
  } catch (e) {
    logError(
      `${chalk.red(`RELEASE FAILED!`)} Stopping right here.`,
      `Make sure to clean up commits and tags as necessary.`
    );
    process.exit(1);
  }
})();
