# PR AutoMerge Management Javascript Action
This action manages the auto-merge state for a PR using labels.

## Inputs

### `activate-label`

**Required** A PR with this label will be configured to auto merge.

### `disabled-label`

**Optional** A PR with this label will have auto-merge forced off.

### `strategy`

**Optional** What merge strategy to use, one of [MERGE, SQUASH, REBASE], defaults to SQUASH


## Example usage

It is recommended that you run this action for label changes as well as when auto-merge is enabled by hand.
```
on:
  pull_request:
    types: [labeled, unlabeled, auto_merge_enabled]
```

Example step
```
name: Configure Auto Merge
uses: CyberGRX/pr-automerge-action@v1.0
id: pr-auto-configuration
env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
with:
    activate-label: 'merge:auto'
    disabled-label: 'merge:manual'
    strategy: 'SQUASH'
```