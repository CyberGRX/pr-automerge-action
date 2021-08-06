import * as core from '@actions/core';
import * as github from '@actions/github';
import * as format from 'string-format';
import { graphql } from '@octokit/graphql';
import {
  WebhookEventMap,
  PullRequestEvent,
  PullRequest,
} from '@octokit/webhooks-types';
import { titleCase } from 'title-case';

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
    pullRequest(number: $number) {
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

declare type PullRequestVariables = {
  owner: String;
  repo: String;
  number: Number;
};

declare type PullRequestAutoMergeResponse = {
  repository?: {
    pullRequest?: {
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

    const setAutoMerge = async (
      pullRequest: PullRequest,
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
      } catch (error) {
        console.log(`Request failed: ${JSON.stringify(error)}`);
      }
    };

    const getAutoMergeState = async () => {
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

        return result.repository?.pullRequest?.autoMergeRequest?.mergeMethod;
      } catch (error) {
        console.log(`Request failed: ${JSON.stringify(error)}`);
      }
      return null;
    };

    const activatedLabel = core.getInput('activate-label');
    const disabledLabel = core.getInput('disabled-label');
    const strategy = core.getInput('strategy');

    const currentMergeState = await getAutoMergeState();

    const payload = github.context.payload as PullRequestEvent;
    const pullRequest = payload.pull_request;
    const foundActiveLabel = pullRequest.labels.find(
      l => l.name === activatedLabel,
    );
    const foundDisabledLabel = pullRequest.labels.find(
      l => l.name === disabledLabel,
    );

    const enableAutoMerge = foundActiveLabel !== undefined;
    const disableAutoMerge = foundDisabledLabel !== undefined;

    const stateMatchesStrategy = currentMergeState === strategy;

    console.log(
      `The github context: ${JSON.stringify(github.context, undefined, 2)}`,
    );

    if (disableAutoMerge && currentMergeState) {
      console.log('Disabling auto-merge for this PR.');
      await setAutoMerge(pullRequest, false, strategy);
    } else if (enableAutoMerge && !stateMatchesStrategy) {
      console.log('Enabling auto-merge for this PR.');
      await setAutoMerge(pullRequest, true, strategy);
    } else {
      console.log('Auto Merge is already in the correct state.');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
