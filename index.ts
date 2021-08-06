import * as core from '@actions/core';
import * as github from '@actions/github';
import { graphql } from '@octokit/graphql';
import { PullRequestEvent, PullRequest } from '@octokit/webhooks-types';

const enableAutoMergeMutation = `mutation enableAutoMerge($pullRequestId: ID!, $strategy: PullRequestMergeMethod) {
  enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: $strategy}) {
    pullRequest {
      id
      autoMergeRequest {
        enabledAt
        mergeMethod
      }
    }
  }
}`;

const mergeBranchMutation = `mutation mergeBranch($repositoryId: ID!, $from: String!, $to: String!) {
  mergeBranch(input:{repositoryId:$repositoryId, base:$to, head:$from}) {
    mergeCommit {
      id
    }
  }
}`;

const disableAutoMergeMutation = `mutation disableAutoMerge($pullRequestId: ID!) {
  disablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) {
    pullRequest {
      id
      autoMergeRequest {
        enabledAt
        mergeMethod
      }
    }
  }
}`;

const getPullRequestQuery = `query getPullRequest($owner: String!, $repo: String!, $number: Int!) {
  repository(name: $repo, owner: $owner) {
    id
    pullRequest(number: $number) {
      headRefName
      baseRefName
      autoMergeRequest {
        mergeMethod
      }
    }
  }
}
`;

declare type AutoMergeVariables = {
  pullRequestId: String;
  strategy?: String;
};

declare type MergeBranchVariables = {
  repositoryId: String;
  from: String;
  to: String;
};

declare type PullRequestVariables = {
  owner: String;
  repo: String;
  number: Number;
};

declare type PullRequestAutoMergeResponse = {
  repository?: {
    id: String;
    pullRequest?: {
      headRefName: String;
      baseRefName: String;
      autoMergeRequest?: {
        mergeMethod: String;
      };
    };
  };
};

async function run() {
  try {
    const token = process.env['GITHUB_TOKEN'];
    if (!token) {
      core.setFailed('GITHUB_TOKEN does not exist.');
      return;
    }

    const graphqlWithAuth = graphql.defaults({
      headers: { authorization: `token ${token}` },
    });

    const mergeBranch = async (variables: MergeBranchVariables) => {
      try {
        const result = await graphqlWithAuth(mergeBranchMutation, variables);
        const response = JSON.stringify(result, undefined, 2);
        console.log(`The response payload: ${response}`);
      } catch (error) {
        console.log(`Request failed: ${JSON.stringify(error)}`);
      }
    };

    const setAutoMerge = async (
      pullRequest: PullRequest,
      retrievedPullRequest: PullRequestAutoMergeResponse,
      enable: boolean,
      strategy: string,
    ) => {
      try {
        const query = enable
          ? enableAutoMergeMutation
          : disableAutoMergeMutation;
        const variables: AutoMergeVariables = {
          pullRequestId: pullRequest.node_id,
        };
        if (enable) {
          variables.strategy = strategy;
        }
        const result = await graphqlWithAuth(query, variables);
        const response = JSON.stringify(result, undefined, 2);
        console.log(`The response payload: ${response}`);

        // Successfully activated auto-merge make sure that base is merged into this branch
        console.log(
          `Merging any changes from ${retrievedPullRequest.repository.pullRequest.baseRefName} into this branch.`,
        );
        mergeBranch({
          repositoryId: retrievedPullRequest.repository.id,
          from: retrievedPullRequest.repository.pullRequest.baseRefName,
          to: retrievedPullRequest.repository.pullRequest.headRefName,
        });
      } catch (error) {
        const errorStr = JSON.stringify(error);
        console.log(`Request failed: ${errorStr}`);

        // Attempt to directly merge if the PR was not in an auto-mergable state (no pending checks == direct merge)
        if (
          retrievedPullRequest &&
          retrievedPullRequest.repository &&
          errorStr.includes(
            'Pull request is not in the correct state to enable auto-merge',
          )
        ) {
          console.log(
            'There were no pending checks, attempting to directly merge this PR.',
          );
          mergeBranch({
            repositoryId: retrievedPullRequest.repository.id,
            from: retrievedPullRequest.repository.pullRequest.headRefName,
            to: retrievedPullRequest.repository.pullRequest.baseRefName,
          });
        }
      }
    };

    const getPullRequest = async () => {
      const variables: PullRequestVariables = {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        number: github.context.payload.pull_request.number,
      };
      try {
        const result = (await graphqlWithAuth(
          getPullRequestQuery,
          variables,
        )) as PullRequestAutoMergeResponse;

        const response = JSON.stringify(result, undefined, 2);
        console.log(`The response payload: ${response}`);

        return result;
      } catch (error) {
        console.log(`Request failed: ${JSON.stringify(error)}`);
      }
      return null;
    };

    const activatedLabel = core.getInput('activate-label');
    const disabledLabel = core.getInput('disabled-label');
    const strategy = core.getInput('strategy') || 'SQUASH';

    const retrievedPullRequest = await getPullRequest();
    const currentMergeState =
      retrievedPullRequest.repository?.pullRequest?.autoMergeRequest
        ?.mergeMethod;

    const payload = github.context.payload as PullRequestEvent;
    const pullRequest = payload.pull_request;
    const foundActiveLabel = pullRequest.labels.find(
      l => l.name === activatedLabel,
    );
    const foundDisabledLabel = pullRequest.labels.find(
      l => l.name === disabledLabel,
    );

    const enableAutoMerge = foundActiveLabel !== undefined;
    const enableLabelRemoved =
      payload.action === 'unlabeled' && payload?.label?.name === activatedLabel;

    // Disable merging if the label is set or the enable label is removed
    const disableAutoMerge =
      foundDisabledLabel !== undefined || enableLabelRemoved;

    const stateMatchesStrategy = currentMergeState === strategy;

    if (disableAutoMerge) {
      if (currentMergeState) {
        console.log('Disabling auto-merge for this PR.');
        await setAutoMerge(pullRequest, null, false, strategy);
      } else {
        console.log('Auto Merge is already in the correct state.');
      }
    } else if (enableAutoMerge && !stateMatchesStrategy) {
      console.log('Enabling auto-merge for this PR.');
      await setAutoMerge(pullRequest, retrievedPullRequest, true, strategy);
    } else {
      console.log('Auto Merge is already in the correct state.');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
