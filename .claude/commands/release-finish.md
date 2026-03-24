# Release Finish Command

Complete a release by creating a git tag and GitHub release after the release PR has been merged to `main`.

## Instructions

1. **Determine the version:**
   - If version provided as argument, use it (e.g., `v2026.1.23.1430`)
   - If no version provided, find the most recent merged release PR:
     ```
     gh pr list --base main --state merged --search "Release in:title" --json number,title,mergedAt,body,url --limit 5
     ```
   - Extract version from PR title (e.g., "Release v2026.1.23.1430" → `v2026.1.23.1430`)

2. **Validate prerequisites:**
   - Ensure `gh` CLI is installed and authenticated
   - Fetch latest from origin: `git fetch origin`

3. **Verify the release PR was merged:**
   - Check that the release PR for this version exists and is merged
   - If no merged PR found, warn the user and ask to confirm proceeding

4. **Check if tag already exists:**
   - Run `git tag -l "v<version>"` to check if tag exists locally
   - Run `git ls-remote --tags origin "v<version>"` to check remote
   - If tag exists, inform user and abort (release already finished)

5. **Create the git tag:**
   - Create annotated tag on origin/main (no need to checkout):
     ```
     git tag -a v<version> origin/main -m "Release v<version>"
     ```
   - Push the tag:
     ```
     git push origin v<version>
     ```

6. **Create GitHub Release:**
   - Fetch the release notes from the merged PR body
   - Create the GitHub release:
     ```
     gh release create v<version> --title "v<version>" --notes "<release-notes-from-pr>"
     ```

7. **Post-completion:**
   - Display success message with formatted box:

```
┌─────────────────────────────────────────────────────────────────┐
│  Release Completed Successfully!                                │
│                                                                 │
│  Version: v2026.1.23.1430                                       │
│  Tag: https://github.com/org/repo/tree/v2026.1.23.1430          │
│  Release: https://github.com/org/repo/releases/tag/v2026.1.23.1430│
│                                                                 │
│  The release is now live!                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Arguments

- `$ARGUMENTS` - Optional: version number (e.g., `v2026.1.23.1430`)
  - Can be provided with or without the `v` prefix
  - Examples: `v2026.1.23.1430`, `2026.1.23.1430`
  - If not provided, auto-detects from most recent merged release PR

## Example Workflow

```bash
# 1. Fetch latest
git fetch origin

# 2. Find most recent release PR (if version not provided)
gh pr list --base main --state merged --search "Release in:title" --json number,title,mergedAt,body,url --limit 1

# 3. Check if tag exists
git tag -l "v2026.1.23.1430"
git ls-remote --tags origin "refs/tags/v2026.1.23.1430"

# 4. Create tag on origin/main (no checkout needed)
git tag -a v2026.1.23.1430 origin/main -m "Release v2026.1.23.1430"

# 5. Push the tag
git push origin v2026.1.23.1430

# 6. Get PR body for release notes
gh pr list --base main --state merged --search "Release v2026.1.23.1430" --json body --jq '.[0].body'

# 7. Create GitHub release
gh release create v2026.1.23.1430 --title "v2026.1.23.1430" --notes "$(gh pr list --base main --state merged --search 'Release v2026.1.23.1430' --json body --jq '.[0].body')"
```

## Example Usage

```bash
# With version from /release output
/release-finish v2026.1.23.1430

# Auto-detect from most recent release PR
/release-finish

# Version without 'v' prefix (will be normalized)
/release-finish 2026.1.23.1430
```

## Error Handling

- If version not provided and no recent release PR found, show error and suggest running `/release` first
- If PR not found or not merged for the specified version, warn user and ask to confirm
- If tag already exists, inform user the release is already complete and show existing release URL
- If tag push fails, show manual recovery steps
- If GitHub release creation fails, note that tag was created and provide manual steps:
  ```
  gh release create v2026.1.23.1430 --title "v2026.1.23.1430" --notes "Release notes here"
  ```

## Notes

- This command is meant to be run after `/release` creates the PR and the PR is merged
- The version number is displayed by the `/release` command output
- The tag is created on `origin/main` directly, so no need to checkout or switch branches
- The GitHub release will use the PR body as release notes (already formatted by `/release`)
- Version format is `yyyy.m.d.hhmm` matching the project's build version
